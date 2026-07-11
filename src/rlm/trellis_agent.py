import os
import sys
import json
import argparse
import threading
from rlm import RLM
from rlm.core.lm_handler import LMRequestHandler
from rlm.utils.prompts import RLM_SYSTEM_PROMPT
from trellis_tools import (
    TrellisNeo4j,
    TrellisPostgres,
    get_tool_call_count,
    RUBRIC_TEXT,
    CITATION_AUDIT_ENABLED,
    CITATION_ENTAIL_ENABLED,
    get_citation_audit,
)
from trellis_mcp import TrellisMcp, parse_mcp_config, build_mcp_addendum, get_mcp_call_count
from trellis_workspace import (
    TrellisWorkspace,
    WORKSPACE_ADDENDUM,
    WORKSPACE_SEEDED_ADDENDUM,
    build_workspace_addendum,
    parse_workspace_bounds,
)
from trellis_modules import (
    RUBRIC_TOKEN,
    build_modules_addendum,
    load_modules,
    parse_module_selection,
)
from trellis_textedit import (
    TrellisTextEdit,
    build_textedit_addendum,
    parse_textedit_bounds,
)
from trellis_answer import TrellisAnswer, get_answer_submit_count

# --- Sub-call counting -------------------------------------------------
# In this rlms version, REPL llm_query()/llm_query_batched() requests are
# served by LMRequestHandler over a local socket, while root-loop calls
# use LMHandler.completion() directly — so patching the socket handlers
# counts exactly the in-REPL sub-LLM invocations. (on_subcall_complete
# only fires for recursive child RLMs when max_depth > 1, and the socket
# path is the only route at max_depth == 1.)
_subcall_lock = threading.Lock()
_subcall_stats = {"count": 0}

_orig_handle_single = LMRequestHandler._handle_single
_orig_handle_batched = LMRequestHandler._handle_batched

def _counted_single(self, request, handler):
    with _subcall_lock:
        _subcall_stats["count"] += 1
    return _orig_handle_single(self, request, handler)

def _counted_batched(self, request, handler):
    n = len(request.prompts) if getattr(request, "prompts", None) else 1
    with _subcall_lock:
        _subcall_stats["count"] += n
    return _orig_handle_batched(self, request, handler)

LMRequestHandler._handle_single = _counted_single
LMRequestHandler._handle_batched = _counted_batched
# -----------------------------------------------------------------------


def on_subcall_complete(depth, model, duration, error):
    # Covers recursive child RLMs if max_depth is ever raised above 1;
    # the socket patch above counts the max_depth == 1 route. Shared by
    # the research and author paths.
    with _subcall_lock:
        _subcall_stats["count"] += 1


def make_entailment_check(postgres_tool):
    """Builds the semantic citation checker (experimental §7 v3): for each
    cited block, asks a checker model whether the block's text supports the
    claim, returning the hashes that do NOT. Uses fetch_texts (non-counted,
    non-audited) so the check never pollutes the citation audit or the
    tool-call count. Only constructed when TRELLIS_CITATION_ENTAIL=1."""
    import openai
    client = openai.OpenAI()

    def check(subject, verb, obj, hashes):
        texts = postgres_tool.fetch_texts(list(hashes))
        unsupported = []
        for h in hashes:
            text = texts.get(h) or ""
            prompt = (
                f"Claim: {subject} {verb} {obj}\n\n"
                f"Source block text:\n{text}\n\n"
                "Does the source block text state or directly support the claim? "
                "Answer with only YES or NO."
            )
            resp = client.chat.completions.create(
                model="gpt-5.4-2026-03-05",
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
            )
            answer = (resp.choices[0].message.content or "").strip().upper()
            if not answer.startswith("YES"):
                unsupported.append(h)
        return unsupported

    return check

# The Trellis directives EXTEND the rlms base prompt rather than replace
# it: the base prompt teaches the model the ```repl``` execution protocol
# and contains the {custom_tools_section} placeholder that rlms fills with
# the injected tool listing. Replacing it leaves the model unable to
# execute any code at all.
#
# NOTE: rlms runs .format() over this string — literal curly braces are
# forbidden here (write Cypher examples without brace syntax). The rubric
# text is loaded from the versioned single-source file and contains JSON
# examples with braces, so it is escaped by doubling before splicing.
_SAFE_RUBRIC = RUBRIC_TEXT.replace("{", "{{").replace("}", "}}")

# Session 15: the addendum is composed — kernel base + registered
# protocol modules + workflow rules. The spatial-flywheel protocol is
# module #0 (modules/spatial-flywheel), loaded by the DEFAULT selection
# so the composed prompt is byte-identical to the pre-extraction
# monolith (pinned by npm run test:modules). Selection is operator-owned
# via TRELLIS_MODULES; module addendum files are brace-free with
# <<TRELLIS_RUBRIC>> as the single substitution token.

# Session 20 (CODE_MEDIATED_TEXT.md §6.2): the code-mediated-text hard
# rule, as a NAMED constant so the Session 21 effective-context probe can
# compose the kernel WITHOUT exactly it. The default composition is
# byte-identical to the pinned prompt (test:modules [4]).
CODE_MEDIATED_TEXT_BLOCK = """CODE-MEDIATED TEXT (HARD RULE): load text into structures and operate on them with code. Locate by query, never by counting lines or guessing positions. Move existing text by slicing and splicing, never by retyping it. Author only genuinely new text.

"""

# Session 21 (pillar §6.3): the discipline-off arm of the effective-
# context probe. Experiment instrumentation in the TRELLIS_CITATION_*
# mold: off by default and byte-identical when unset (pinned by
# test:modules [4]/[7]); never set by any default, worker, or Compose
# configuration; buildAgentEnv strips any inherited value, so only an
# experiment runner's own spawn env can enable it. When set, exactly
# CODE_MEDIATED_TEXT_BLOCK is absent and nothing else changes
# (test:modules [7] pins the omitted composition; through Session 21
# that equaled the pre-Session-20 kernel byte-for-byte — the Session 22
# answer-channel revision lands in both arms, so the omit arm is now
# purely structural: the default kernel minus exactly the block).
EXP_OMIT_CMT_ENABLED = os.getenv("TRELLIS_EXP_OMIT_CMT") == "1"

_ADDENDUM_BASE_PREFIX = """

=== TRELLIS ENGINE DIRECTIVES ===
You are the Trellis RLM, a Deterministic Spatial Reasoning Engine. The `context` variable holds the user's query text; the real knowledge lives in the two injected database tools.

TURN DISCIPLINE (HARD RULE): every single response you produce MUST contain exactly one ```repl``` code block, until the turn where you finish by calling trellis_answer.submit (which sets answer['content'] and answer['ready'] = True for you). Planning prose without a ```repl``` block is a protocol violation and wastes an iteration. An answer produced without executing any database tool call has NO PROVENANCE and will be rejected — never output a final answer unless your repl code has actually queried the databases in this session. Start executing code in your VERY FIRST response.

TOOLS (available directly in the REPL):
1. `trellis_neo4j`: a read-only Neo4j wrapper.
   - `trellis_neo4j.run_cypher(query)` explores the semantic graph. DO NOT USE CREATE, MERGE, DELETE, SET, or DROP.
   - Node labels include Question (properties: id like 'q_0001', text, sometimes category), Concept (name), Entity (name).
   - Edge types include REFERENCES, ACTION, CONTRADICTS, and DERIVED_INSIGHT.
   - Nodes and edges carry `sourceNodeIds`: the AST node hashes (spatial provenance) they were derived from.
   - The ONLY permitted writes are `trellis_neo4j.write_derived_insight(subject, verb, obj, sourceNodeIds, confidence=None)`, which caches a deduced fact as a DERIVED_INSIGHT edge with spatial provenance, and its bulk variant `trellis_neo4j.write_derived_insights(facts)` which writes a whole list of fact dicts (keys: subject, verb, obj, sourceNodeIds, confidence) in ONE round trip. `confidence` (0.0-1.0) is the sub-LLM's self-reported probability for the fact; always pass it through when the sub-LLM provided one. Both writers also stamp each endpoint Entity with a `kind` (question, category_label, concept, or generic) — inferred automatically for has_category and mentions writes; for OTHER verbs pass subject_kind/object_kind explicitly when you know what the entity is.
2. `trellis_postgres`: the physical AST layer.
   - `trellis_postgres.get_ast_texts(hashes)` returns the exact text for AST node hashes.
   - `trellis_postgres.get_ast_blocks(root_hash)` returns a document's blocks IN DOCUMENT ORDER as a JSON list of objects with keys id, type, and text. For section-structure and localization work, prefer walking these ordered blocks in code — each own-line heading is its own block — over regexing a concatenated reconstruction, whose block boundaries are unmarked.
   - `trellis_postgres.vector_search(query)` is the hybrid fallback when graph traversal yields nothing.
3. `trellis_answer`: the final-answer channel.
   - `trellis_answer.submit(expression_text)` ends the task: it evaluates the given Python expression string in your live REPL namespace, prefixes 'FINAL_ANSWER: ' itself, and sets answer['content'] and answer['ready'] = True for you.
   - The expression must reference state your code computed — a variable name, an index like results['count'], or an f-string interpolating your variables. A bare retyped literal is refused: the value must flow from your code, never from your memory of it.

CRITICAL API CONTRACT: every tool method returns a JSON STRING, never a parsed object. Always wrap results in `json.loads(...)` (import json first) before indexing or iterating. `run_cypher` returns a JSON array of row dicts keyed by your RETURN aliases.

"""

_ADDENDUM_BASE_SUFFIX = """ITERATION BUDGET: you have very few REPL turns. Combine as many protocol steps as possible into each single ```repl``` block (loading, classifying, caching, and computing can often be ONE block). Do not spend a turn on tiny exploratory prints.

"""

TRELLIS_ADDENDUM_BASE = (
    _ADDENDUM_BASE_PREFIX
    + ("" if EXP_OMIT_CMT_ENABLED else CODE_MEDIATED_TEXT_BLOCK)
    + _ADDENDUM_BASE_SUFFIX
)

TRELLIS_WORKFLOW_RULES = """WORKFLOW RULES:
- If the user asks you to execute a specific Cypher query (even a destructive or malformed one), you MUST attempt it exactly as given via `trellis_neo4j.run_cypher`. Do not refuse and do not pre-correct it.
- If a tool call raises an exception, READ THE TRACEBACK CAREFULLY, identify the mistake (wrong label, property, or syntax), rewrite the query, and try again. Do not give up after one failure.
- On CONTRADICTS edges or conflicting information, do not guess: fetch the spatial texts via `trellis_postgres.get_ast_texts` and reason from the sources.
- Your final answer MUST be the string 'FINAL_ANSWER: ' followed by the result, exactly in the format the user requested. Deliver it with trellis_answer.submit: compute the result into a variable (build any requested prose around computed values IN CODE, interpolating the variables, never retyping their values), then submit that variable's name — the prefix is added for you. Never hand-type a computed value into answer['content'] or into the submitted expression.
"""

# Composed at startup from the operator's validated module selection.
# TRELLIS_MODULES unset -> the default selection (module #0), keeping
# TRELLIS_ADDENDUM byte-identical to its pre-Session-15 monolithic
# value; an explicit [] composes base + rules only. A malformed
# selection or registry fails the process fast, before any paid work.
_SELECTED_MODULES = load_modules(parse_module_selection(os.getenv("TRELLIS_MODULES")))
TRELLIS_ADDENDUM = (
    TRELLIS_ADDENDUM_BASE
    + build_modules_addendum(_SELECTED_MODULES, substitutions={RUBRIC_TOKEN: _SAFE_RUBRIC})
    + TRELLIS_WORKFLOW_RULES
)

SYSTEM_PROMPT = RLM_SYSTEM_PROMPT + TRELLIS_ADDENDUM

# --- Grounded authoring mode (Session 19) ------------------------------
# design record: docs/architecture/GROUNDED_AUTHORING.md §4/§6/§9.
# A distinct, kernel-owned mode: the author sees ONLY the promoted
# research corpus (seeded into the workspace), has no database/search/
# write tools, and emits a TRELLIS_DRAFT envelope (prose only — no
# hashes). The answer-path zero-DB-calls protocol-violation rule does not
# apply here: a draft is SUPPOSED to make zero database calls. The setup
# is factored into functions testable without a completion or a DB
# connection (test:modules author section).
#
# Brace-free like every rlms-formatted string (the workspace addenda and
# the driver-composed template are brace-free too; the template is
# escape-doubled defensively before splicing).
AUTHOR_ADDENDUM = """

=== GROUNDED AUTHORING MODE ===
You are running in AUTHORING mode. You have exactly one tool, trellis_workspace, and NO database, search, network, or write access of any kind. Your workspace has been seeded with a FIXED research corpus — one segment per corpus block. Derive the requested protocol from that corpus and from nothing else.
- Read the corpus first: call trellis_workspace.read() for the index, then trellis_workspace.segment(segment_id) to read each block you rely on. You may fan llm_query over segment contents to summarize.
- Every directive you output must be grounded in the seeded corpus. Do not import directives from your own prior knowledge of the topic; where the corpus is silent, record a gap note instead of inventing.
- You do NOT choose citations and cannot emit source hashes: research provenance is pinned by the harness from the promoted corpus, never by you. Never write a 64-character hexadecimal hash into your answer.
- When the protocol is complete, set answer['content'] to a SINGLE JSON object serialized as a string, with exactly the keys purpose, addendum, and gap_notes (a list of strings), and set answer['ready'] = True. Do not prefix it with FINAL_ANSWER or wrap it in any other prose.
"""


def build_author_tools(workspace):
    """The author-mode tool surface: trellis_workspace and nothing else
    (design record §4, D4). No DB tools are even constructed."""
    return {"trellis_workspace": workspace}


def build_author_system_prompt(template_query):
    """Composes the author system prompt: the rlms base REPL protocol +
    the authoring-mode addendum + the workspace surface (always seeded in
    author mode) + the driver-composed authoring template as the task.
    The template is brace-free by construction; it is escape-doubled here
    defensively because rlms runs .format() over the system prompt."""
    safe_query = template_query.replace("{", "{{").replace("}", "}}")
    return (
        RLM_SYSTEM_PROMPT
        + AUTHOR_ADDENDUM
        + WORKSPACE_ADDENDUM
        + WORKSPACE_SEEDED_ADDENDUM
        + "\n\nTHE AUTHORING TASK FOLLOWS — EXECUTE IT IMMEDIATELY.\n\n"
        + safe_query
        + "\n"
    )


def extract_draft_envelope(response):
    """Parses the model's final answer into the TRELLIS_DRAFT payload
    (purpose, addendum, gapNotes) or returns None. The model is asked for
    a single JSON object; we tolerate surrounding prose by taking the
    outermost braces. The harness never lets the model supply provenance,
    so hashes are neither read nor forwarded — the Node scanner refuses
    any draft carrying a 64-hex token independently."""
    if not isinstance(response, str):
        return None
    start = response.find("{")
    end = response.rfind("}")
    if start == -1 or end == -1 or end < start:
        return None
    try:
        data = json.loads(response[start:end + 1])
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    purpose = data.get("purpose")
    addendum = data.get("addendum")
    gap_notes = data.get("gap_notes", data.get("gapNotes", []))
    if not isinstance(purpose, str) or not isinstance(addendum, str):
        return None
    if not isinstance(gap_notes, list) or any(not isinstance(n, str) for n in gap_notes):
        return None
    return {"purpose": purpose, "addendum": addendum, "gapNotes": gap_notes}


def run_author_mode(args):
    """The --mode author branch: seed the promoted corpus, run the RLM
    with only the workspace tool, and emit one TRELLIS_DRAFT envelope. No
    database or MCP tool is ever constructed, so the process opens no DB
    connection. A malformed or over-budget seed raises before any paid
    work (the Session 16 over-budget-seed rule)."""
    if not args.seed_workspace:
        print("Author mode requires --seed-workspace (the promoted corpus seed).", flush=True)
        return 1

    exit_code = 0
    workspace = None
    try:
        max_segments, max_bytes = parse_workspace_bounds()
        with open(args.seed_workspace, encoding="utf-8") as seed_file:
            seed_data = json.load(seed_file)
        workspace = TrellisWorkspace.seed_from_snapshot(
            seed_data, max_segments=max_segments, max_bytes=max_bytes, goal_id=args.goal_id,
        )
        custom_tools = build_author_tools(workspace)
        system_prompt = build_author_system_prompt(args.query)

        print("Starting RLM Author run (grounded authoring mode).", flush=True)
        rlm = RLM(
            environment="local",
            verbose=True,
            max_iterations=args.max_iterations,
            backend_kwargs={"model_name": "gpt-5.4-2026-03-05"},
            environment_kwargs={},
            custom_tools=custom_tools,
            custom_system_prompt=system_prompt,
            on_subcall_complete=on_subcall_complete,
        )
        result = rlm.completion(args.query)
        response = getattr(result, "response", None) or str(result)
        print("\n--- RLM Draft ---", flush=True)
        print(response, flush=True)

        usage = getattr(result, "usage_summary", None)
        usage_dict = usage.to_dict() if usage else {}
        telemetry_payload = {
            "mode": "author",
            "input_tokens": usage.total_input_tokens if usage else 0,
            "output_tokens": usage.total_output_tokens if usage else 0,
            "reported_cost_usd": usage.total_cost if usage else None,
            "subcall_count": _subcall_stats["count"],
            # Author mode makes no database or MCP calls by construction.
            "tool_calls": get_tool_call_count(),
            "mcp_calls": get_mcp_call_count(),
            **workspace.stats(),
            "execution_time_s": getattr(result, "execution_time", None),
            "model_usage": usage_dict.get("model_usage_summaries", {}),
        }
        print(f"TRELLIS_TELEMETRY: {json.dumps(telemetry_payload)}", flush=True)

        # Author mode NEVER emits TRELLIS_RESULT or TRELLIS_PROTOCOL_VIOLATION
        # — the zero-database-calls rule does not apply to drafting.
        draft = extract_draft_envelope(response)
        if draft is None:
            print(
                "Author run produced no parseable draft envelope "
                "(expected a JSON object with purpose, addendum, gap_notes).",
                flush=True,
            )
            exit_code = 1
        else:
            print(f"TRELLIS_DRAFT: {json.dumps(draft)}", flush=True)

    except BaseException as e:
        import traceback
        print(f"RLM Author Error: {type(e).__name__} - {str(e)}", flush=True)
        traceback.print_exc()
        exit_code = 1
    finally:
        # Author runs are self-contained; the only resource is the
        # workspace, which needs no close. Serialize it if requested (the
        # lineage seam), success or not.
        if args.workspace_out and workspace is not None and not workspace.is_empty():
            try:
                with open(args.workspace_out, "w", encoding="utf-8") as out_file:
                    out_file.write(workspace.snapshot())
            except OSError as e:
                print(f"Workspace serialization failed: {type(e).__name__} - {e}", flush=True)

    return exit_code


def main():
    parser = argparse.ArgumentParser(description="Trellis RLM Agent")
    parser.add_argument("--query", type=str, required=True, help="The user query to solve")
    parser.add_argument("--mode", type=str, default="research", choices=["research", "author"],
                        help="Run mode (Session 19). 'research' (default) is the ordinary "
                             "database-backed agent — byte-identical to before. 'author' is "
                             "grounded authoring: workspace-only, no database, TRELLIS_DRAFT output.")
    parser.add_argument("--max-iterations", type=int, default=5, help="Max root REPL iterations")
    parser.add_argument("--goal-id", type=str, default=None,
                        help="Goal correlation id (Session 14: also gates the Tier-3 workspace on)")
    parser.add_argument("--workspace-out", type=str, default=None,
                        help="Session 16 lineage: write the end-of-run workspace snapshot "
                             "to this file (success or not) so the worker can park it")
    parser.add_argument("--seed-workspace", type=str, default=None,
                        help="Session 16 lineage: JSON snapshot file (worker-resolved and "
                             "merged) to pre-populate the workspace from at spawn")
    args = parser.parse_args()

    # Session 19: author mode is a distinct, DB-free branch — no
    # TrellisPostgres/TrellisNeo4j construction at all, so the process
    # opens no database connection.
    if args.mode == "author":
        sys.exit(run_author_mode(args))

    # Initialize tools. The Neo4j write path verifies cited AST hashes
    # against ast_nodes through the Postgres tool (Session 14 §10.2) —
    # unconditional, no toggle.
    postgres_tool = TrellisPostgres()
    entailment_check = make_entailment_check(postgres_tool) if CITATION_ENTAIL_ENABLED else None
    neo4j_tool = TrellisNeo4j(
        ast_existence_check=postgres_tool.ast_hashes_exist,
        entailment_check=entailment_check,
    )
    mcp_tool = None

    print(f"Starting RLM Agent for query: '{args.query}'", flush=True)

    # Sub-calls are counted via the LMRequestHandler patch above; the
    # module-level on_subcall_complete callback additionally covers
    # recursive child RLMs if max_depth is ever raised above 1. Iteration
    # count is parsed by the Node runner from the rlms summary banner
    # (this rlms version never fires on_iteration_complete).
    exit_code = 0
    workspace = None
    textedit = None
    try:
        # Session 10: the external tool surface comes exclusively from the
        # validated TRELLIS_MCP_SERVERS registry the worker forwarded
        # (re-validated here defensively). With no servers configured,
        # nothing is injected and the system prompt is byte-identical to a
        # pre-Session-10 run (build_mcp_addendum([]) is the empty string).
        mcp_servers = parse_mcp_config(os.getenv("TRELLIS_MCP_SERVERS"))
        # Session 22: the by-reference final-answer channel is kernel
        # surface in every research run — the answer value flows from the
        # REPL namespace by evaluation, never by the model retyping it
        # (CODE_MEDIATED_TEXT.md applied to the last unmediated channel).
        custom_tools = {
            "trellis_neo4j": neo4j_tool,
            "trellis_postgres": postgres_tool,
            "trellis_answer": TrellisAnswer(),
        }

        # Session 14: the Tier-3 workspace is injected only when external
        # tools are configured OR the run belongs to a goal — a bare
        # pre-existing run stays byte-identical (prompt and behavior),
        # the empty-registry MCP precedent, pinned by test:rlm-workspace.
        # Session 16: a seeded run always gets a workspace (it carries
        # --goal-id by construction; the seed arg is included defensively).
        # A malformed or over-budget seed raises HERE, before any paid
        # work — a broken inheritance fails the task fast (§5).
        if args.seed_workspace:
            max_segments, max_bytes = parse_workspace_bounds()
            with open(args.seed_workspace, encoding="utf-8") as seed_file:
                seed_data = json.load(seed_file)
            workspace = TrellisWorkspace.seed_from_snapshot(
                seed_data,
                max_segments=max_segments,
                max_bytes=max_bytes,
                goal_id=args.goal_id,
            )
            custom_tools["trellis_workspace"] = workspace
        elif mcp_servers or args.goal_id:
            max_segments, max_bytes = parse_workspace_bounds()
            workspace = TrellisWorkspace(
                max_segments=max_segments,
                max_bytes=max_bytes,
                goal_id=args.goal_id,
            )
            custom_tools["trellis_workspace"] = workspace

        if mcp_servers:
            mcp_tool = TrellisMcp(mcp_servers, workspace=workspace)
            custom_tools["trellis_mcp"] = mcp_tool
            print(f"MCP servers connected: {', '.join(s['name'] for s in mcp_servers)}", flush=True)

        # Session 20: the code-mediated editing toolkit (design record
        # CODE_MEDIATED_TEXT.md §6.1) is injected ONLY when the operator
        # set TRELLIS_EDIT_ROOT — never from a payload or a completion.
        # Unset means nothing is injected and the prompt is byte-identical
        # (the TRELLIS_MCP_SERVERS gating precedent, pinned by
        # test:textedit). A bad root or bad bounds fail HERE, before any
        # paid work.
        edit_root = os.getenv("TRELLIS_EDIT_ROOT")
        if edit_root and edit_root.strip():
            max_file_bytes, max_files = parse_textedit_bounds()
            textedit = TrellisTextEdit(
                edit_root, max_file_bytes=max_file_bytes, max_files=max_files)
            custom_tools["trellis_textedit"] = textedit
            print("Text editing toolkit enabled (operator-configured edit root).", flush=True)

        # Inject the query directly into the system prompt to ensure the LLM sees it and doesn't ask for it.
        # Curly braces are escaped because rlms applies .format() to the system prompt.
        safe_query = args.query.replace("{", "{{").replace("}", "}}")
        dynamic_system_prompt = (
            SYSTEM_PROMPT
            + build_mcp_addendum(mcp_servers)
            + build_workspace_addendum(workspace, seeded=bool(args.seed_workspace))
            + build_textedit_addendum(textedit)
            + f"\n\nTHE USER'S QUERY IS: {safe_query}\nDO NOT ASK FOR A QUERY, THIS IS IT. EXECUTE IT IMMEDIATELY."
        )

        rlm = RLM(
            environment="local",
            verbose=True,
            max_iterations=args.max_iterations,
            backend_kwargs={"model_name": "gpt-5.4-2026-03-05"},
            environment_kwargs={},
            custom_tools=custom_tools,
            custom_system_prompt=dynamic_system_prompt,
            on_subcall_complete=on_subcall_complete,
        )

        # Run the RLM to solve the query
        result = rlm.completion(args.query)
        response = getattr(result, "response", None) or str(result)
        print(f"\n--- RLM Result ---", flush=True)
        print(response, flush=True)

        # The agent should naturally output FINAL_ANSWER, but just in case:
        if "FINAL_ANSWER:" not in response:
            print(f"FINAL_ANSWER: {response}", flush=True)

        # Machine-parseable telemetry line for the benchmark runner.
        usage = getattr(result, "usage_summary", None)
        usage_dict = usage.to_dict() if usage else {}
        telemetry_payload = {
            "input_tokens": usage.total_input_tokens if usage else 0,
            "output_tokens": usage.total_output_tokens if usage else 0,
            "reported_cost_usd": usage.total_cost if usage else None,
            "subcall_count": _subcall_stats["count"],
            "tool_calls": get_tool_call_count(),
            # Session 10: MCP usage is counted separately from database
            # tool calls — it never feeds the provenance requirement.
            "mcp_calls": get_mcp_call_count(),
            # Session 14: workspace activity — counts only, never content
            # (T16). Like mcp_calls, none of it feeds the provenance
            # requirement.
            **(workspace.stats() if workspace is not None else
               {"workspace_ops": 0, "workspace_segments": 0, "workspace_bytes": 0}),
            # Session 20: editing-toolkit activity — counts only, never a
            # path, pattern, or content (T16). Like mcp_calls, none of it
            # feeds the provenance requirement.
            **(textedit.stats() if textedit is not None else
               {"textedit_ops": 0, "textedit_files": 0, "textedit_writes": 0}),
            # Session 22: how many times the run set its answer through
            # the mediated by-reference channel — a count only, additive
            # (the Node scanner tolerates and ignores unknown fields).
            "answer_submits": get_answer_submit_count(),
            "execution_time_s": getattr(result, "execution_time", None),
            "model_usage": usage_dict.get("model_usage_summaries", {}),
        }
        print(f"TRELLIS_TELEMETRY: {json.dumps(telemetry_payload)}", flush=True)

        # Opt-in citation audit for the provenance-citation A/B eval
        # (TRELLIS_CITATION_AUDIT=1). Off by default: a normal run emits
        # nothing here and stays byte-identical.
        if CITATION_AUDIT_ENABLED:
            print(f"TRELLIS_CITATION_AUDIT: {json.dumps(get_citation_audit())}", flush=True)

        if get_tool_call_count() == 0:
            # The agent answered without touching either database — the
            # answer has no provenance and the runner should re-dispatch.
            print("TRELLIS_PROTOCOL_VIOLATION: zero database tool calls — answer has no provenance.", flush=True)

        # Session 9: one machine-readable result envelope for the
        # orchestrator, alongside the prose FINAL_ANSWER convention the
        # benchmark client scrapes. The answer is the text after the last
        # FINAL_ANSWER marker (matching the benchmark client's
        # lastIndexOf extraction); a zero-tool-call answer is reported as
        # a protocol violation so the goal loop can react to it.
        marker = "FINAL_ANSWER:"
        answer = response.rsplit(marker, 1)[-1].strip() if marker in response else response.strip()
        result_payload = {
            "status": "protocol_violation" if get_tool_call_count() == 0 else "ok",
            "answer": answer,
            "toolCalls": get_tool_call_count(),
        }
        print(f"TRELLIS_RESULT: {json.dumps(result_payload)}", flush=True)

    except BaseException as e:
        import traceback
        print(f"RLM Execution Error: {type(e).__name__} - {str(e)}", flush=True)
        traceback.print_exc()
        result_payload = {"status": "error", "answer": None, "toolCalls": get_tool_call_count()}
        print(f"TRELLIS_RESULT: {json.dumps(result_payload)}", flush=True)
        exit_code = 1
    finally:
        # Session 16 lineage serialization: success or not, a non-empty
        # workspace is written to the worker-named temp file (no giant
        # stdout lines — the telemetry scanner stays bounded and SSE
        # clients see nothing new). A partial workspace from a failed run
        # is still worth parking: it can seed the retry. A write failure
        # is reported but never masks the run's own result.
        if args.workspace_out and workspace is not None and not workspace.is_empty():
            try:
                with open(args.workspace_out, "w", encoding="utf-8") as out_file:
                    out_file.write(workspace.snapshot())
            except OSError as e:
                print(f"Workspace serialization failed: {type(e).__name__} - {e}", flush=True)
        neo4j_tool.close()
        postgres_tool.close()
        if mcp_tool is not None:
            mcp_tool.close()

    sys.exit(exit_code)

if __name__ == "__main__":
    main()
