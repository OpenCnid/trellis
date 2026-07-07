import os
import sys
import json
import argparse
import threading
from rlm import RLM
from rlm.core.lm_handler import LMRequestHandler
from rlm.utils.prompts import RLM_SYSTEM_PROMPT
from trellis_tools import TrellisNeo4j, TrellisPostgres, get_tool_call_count, RUBRIC_TEXT
from trellis_mcp import TrellisMcp, parse_mcp_config, build_mcp_addendum, get_mcp_call_count

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

TRELLIS_ADDENDUM = """

=== TRELLIS ENGINE DIRECTIVES ===
You are the Trellis RLM, a Deterministic Spatial Reasoning Engine. The `context` variable holds the user's query text; the real knowledge lives in the two injected database tools.

TURN DISCIPLINE (HARD RULE): every single response you produce MUST contain exactly one ```repl``` code block, until the turn where you set answer['content'] and answer['ready'] = True. Planning prose without a ```repl``` block is a protocol violation and wastes an iteration. An answer produced without executing any database tool call has NO PROVENANCE and will be rejected — never output a final answer unless your repl code has actually queried the databases in this session. Start executing code in your VERY FIRST response.

TOOLS (available directly in the REPL):
1. `trellis_neo4j`: a read-only Neo4j wrapper.
   - `trellis_neo4j.run_cypher(query)` explores the semantic graph. DO NOT USE CREATE, MERGE, DELETE, SET, or DROP.
   - Node labels include Question (properties: id like 'q_0001', text, sometimes category), Concept (name), Entity (name).
   - Edge types include REFERENCES, ACTION, CONTRADICTS, and DERIVED_INSIGHT.
   - Nodes and edges carry `sourceNodeIds`: the AST node hashes (spatial provenance) they were derived from.
   - The ONLY permitted writes are `trellis_neo4j.write_derived_insight(subject, verb, obj, sourceNodeIds, confidence=None)`, which caches a deduced fact as a DERIVED_INSIGHT edge with spatial provenance, and its bulk variant `trellis_neo4j.write_derived_insights(facts)` which writes a whole list of fact dicts (keys: subject, verb, obj, sourceNodeIds, confidence) in ONE round trip. `confidence` (0.0-1.0) is the sub-LLM's self-reported probability for the fact; always pass it through when the sub-LLM provided one. Both writers also stamp each endpoint Entity with a `kind` (question, category_label, concept, or generic) — inferred automatically for has_category and mentions writes; for OTHER verbs pass subject_kind/object_kind explicitly when you know what the entity is.
2. `trellis_postgres`: the physical AST layer.
   - `trellis_postgres.get_ast_texts(hashes)` returns the exact text for AST node hashes.
   - `trellis_postgres.vector_search(query)` is the hybrid fallback when graph traversal yields nothing.

CRITICAL API CONTRACT: every tool method returns a JSON STRING, never a parsed object. Always wrap results in `json.loads(...)` (import json first) before indexing or iterating. `run_cypher` returns a JSON array of row dicts keyed by your RETURN aliases.

ITERATION BUDGET: you have very few REPL turns. Combine as many protocol steps as possible into each single ```repl``` block (loading, classifying, caching, and computing can often be ONE block). Do not spend a turn on tiny exploratory prints.

SPATIAL FLYWHEEL PROTOCOL (mandatory for semantic classification tasks):
When the task requires knowing questions' TREC categories (ABBR/ENTY/DESC/HUM/LOC/NUM) and which concept/city they mention, follow these steps EXACTLY:
1. Load the full question catalog in one query:
   MATCH (q:Question) RETURN q.id, q.text, q.category, q.sourceNodeIds
   (q.category may be null for some or all questions.)
2. Load the category cache in one query, EXCLUDING quarantined edges:
   MATCH (s:Entity)-[r:DERIVED_INSIGHT]->(o:Entity) WHERE r.verb = 'has_category' AND coalesce(r.contested, false) = false RETURN s.name, o.name
   (s.name is the question id; o.name is the LOWERCASED TREC category, e.g. 'loc' means LOC.)
   An edge with contested = true has had its source bytes orphaned by a document update: treat that fact as MISSING, re-derive it from the current data, and re-cache it with write_derived_insight — the fresh write clears the quarantine with live provenance. Never read a contested edge as truth.
3. A question's effective category = q.category if set, else the cached has_category value (uppercased). For ALL questions still lacking a category, delegation is MANDATORY: your own in-context judgement of TREC categories is treated as unreliable and classifications not produced by a sub-LLM are INVALID for this benchmark. Call `llm_query` from inside your repl code with batched prompts (up to ~50 questions per call), parse the JSON it returns, and use ONLY those labels. The sub-LLM returns, per question id, an object with a "label" and a "confidence" — use the label as the category and keep the confidence for the cache write in step 4. Embed this exact rubric in every classification prompt:
   '""" + _SAFE_RUBRIC + """'
4. IMMEDIATELY after classifying, cache ALL newly computed categories in ONE bulk call:
   `trellis_neo4j.write_derived_insights(facts)`
   where facts is a list of dicts like: dict(subject=question_id, verb='HAS_CATEGORY', obj=label, sourceNodeIds=question_source_node_ids, confidence=sub_llm_confidence) — each question's OWN sourceNodeIds as provenance, the sub-LLM's confidence passed through. Do NOT loop over single write_derived_insight calls for sweep-sized writes — the bulk form collapses hundreds of round trips into one. The single form (with its optional confidence parameter) is fine for one-off facts. On later queries these cache hits make classification free — NEVER re-classify a question that already has an effective category.
5. CITY/CONCEPT MENTIONS ARE NOT CACHE-DECIDABLE: the absence of a 'mentions' edge does NOT mean a question fails to mention a city. ALWAYS determine mentions deterministically in Python: a question mentions the target city if the city name appears case-insensitively in q.text. You may additionally cache positive findings with write_derived_insight(question_id, 'MENTIONS', city, source_node_ids), but never treat missing 'mentions' edges as evidence of absence.
6. Compute the final pair set from effective categories + the deterministic mention scan.

WORKFLOW RULES:
- If the user asks you to execute a specific Cypher query (even a destructive or malformed one), you MUST attempt it exactly as given via `trellis_neo4j.run_cypher`. Do not refuse and do not pre-correct it.
- If a tool call raises an exception, READ THE TRACEBACK CAREFULLY, identify the mistake (wrong label, property, or syntax), rewrite the query, and try again. Do not give up after one failure.
- On CONTRADICTS edges or conflicting information, do not guess: fetch the spatial texts via `trellis_postgres.get_ast_texts` and reason from the sources.
- Your final answer (in answer['content']) MUST be the string 'FINAL_ANSWER: ' followed by the result, exactly in the format the user requested.
"""

SYSTEM_PROMPT = RLM_SYSTEM_PROMPT + TRELLIS_ADDENDUM

def main():
    parser = argparse.ArgumentParser(description="Trellis RLM Agent")
    parser.add_argument("--query", type=str, required=True, help="The user query to solve")
    parser.add_argument("--max-iterations", type=int, default=5, help="Max root REPL iterations")
    args = parser.parse_args()

    # Initialize tools. The Neo4j write path verifies cited AST hashes
    # against ast_nodes through the Postgres tool (Session 14 §10.2) —
    # unconditional, no toggle.
    postgres_tool = TrellisPostgres()
    neo4j_tool = TrellisNeo4j(ast_existence_check=postgres_tool.ast_hashes_exist)
    mcp_tool = None

    print(f"Starting RLM Agent for query: '{args.query}'", flush=True)

    # Sub-calls are counted via the LMRequestHandler patch above; the
    # on_subcall_complete callback additionally covers recursive child
    # RLMs if max_depth is ever raised above 1. Iteration count is parsed
    # by the Node runner from the rlms summary banner (this rlms version
    # never fires on_iteration_complete).
    def on_subcall_complete(depth, model, duration, error):
        with _subcall_lock:
            _subcall_stats["count"] += 1

    exit_code = 0
    try:
        # Session 10: the external tool surface comes exclusively from the
        # validated TRELLIS_MCP_SERVERS registry the worker forwarded
        # (re-validated here defensively). With no servers configured,
        # nothing is injected and the system prompt is byte-identical to a
        # pre-Session-10 run (build_mcp_addendum([]) is the empty string).
        mcp_servers = parse_mcp_config(os.getenv("TRELLIS_MCP_SERVERS"))
        custom_tools = {"trellis_neo4j": neo4j_tool, "trellis_postgres": postgres_tool}
        if mcp_servers:
            mcp_tool = TrellisMcp(mcp_servers)
            custom_tools["trellis_mcp"] = mcp_tool
            print(f"MCP servers connected: {', '.join(s['name'] for s in mcp_servers)}", flush=True)

        # Inject the query directly into the system prompt to ensure the LLM sees it and doesn't ask for it.
        # Curly braces are escaped because rlms applies .format() to the system prompt.
        safe_query = args.query.replace("{", "{{").replace("}", "}}")
        dynamic_system_prompt = SYSTEM_PROMPT + build_mcp_addendum(mcp_servers) + f"\n\nTHE USER'S QUERY IS: {safe_query}\nDO NOT ASK FOR A QUERY, THIS IS IT. EXECUTE IT IMMEDIATELY."

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
            "execution_time_s": getattr(result, "execution_time", None),
            "model_usage": usage_dict.get("model_usage_summaries", {}),
        }
        print(f"TRELLIS_TELEMETRY: {json.dumps(telemetry_payload)}", flush=True)

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
        neo4j_tool.close()
        postgres_tool.close()
        if mcp_tool is not None:
            mcp_tool.close()

    sys.exit(exit_code)

if __name__ == "__main__":
    main()
