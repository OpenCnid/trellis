import sys
import json
import argparse
import threading
from rlm import RLM
from rlm.core.lm_handler import LMRequestHandler
from rlm.utils.prompts import RLM_SYSTEM_PROMPT
from trellis_tools import TrellisNeo4j, TrellisPostgres, get_tool_call_count

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
# forbidden here (write Cypher examples without brace syntax).
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
   - The ONLY permitted write is `trellis_neo4j.write_derived_insight(subject, verb, obj, sourceNodeIds)`, which caches a deduced fact as a DERIVED_INSIGHT edge with spatial provenance.
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
2. Load the category cache in one query:
   MATCH (s:Entity)-[r:DERIVED_INSIGHT]->(o:Entity) WHERE r.verb = 'has_category' RETURN s.name, o.name
   (s.name is the question id; o.name is the LOWERCASED TREC category, e.g. 'loc' means LOC.)
3. A question's effective category = q.category if set, else the cached has_category value (uppercased). For ALL questions still lacking a category, delegation is MANDATORY: your own in-context judgement of TREC categories is treated as unreliable and classifications not produced by a sub-LLM are INVALID for this benchmark. Call `llm_query` from inside your repl code with batched prompts (up to ~50 questions per call), parse the JSON it returns, and use ONLY those labels. Embed this exact rubric in every classification prompt:
   'Classify each question by the TYPE OF ANSWER it expects: LOC = the answer is a place, country, city, river, lake, ocean, mountain range, landmark, or hemisphere (e.g., "Which river runs through..." or "What mountain range is visible..." are LOC because the answer names a geographic body); HUM = the answer is a person or group of people (who...); NUM = the answer is a number, count, year, or quantity; ENTY = the answer is a non-geographic thing, object, animal, plant, food, or organization; DESC = the answer is a definition, explanation, or reason (what is X, why, how does); ABBR = the question asks to expand or interpret an abbreviation/acronym. Return ONLY a JSON object mapping each question id to one of ABBR/ENTY/DESC/HUM/LOC/NUM.'
4. IMMEDIATELY after classifying, cache every newly computed category:
   `trellis_neo4j.write_derived_insight(question_id, 'HAS_CATEGORY', category_label, source_node_ids)`
   using that question's own sourceNodeIds as provenance. On later queries these cache hits make classification free — NEVER re-classify a question that already has an effective category.
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

    # Initialize tools
    neo4j_tool = TrellisNeo4j()
    postgres_tool = TrellisPostgres()

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
        # Inject the query directly into the system prompt to ensure the LLM sees it and doesn't ask for it.
        # Curly braces are escaped because rlms applies .format() to the system prompt.
        safe_query = args.query.replace("{", "{{").replace("}", "}}")
        dynamic_system_prompt = SYSTEM_PROMPT + f"\n\nTHE USER'S QUERY IS: {safe_query}\nDO NOT ASK FOR A QUERY, THIS IS IT. EXECUTE IT IMMEDIATELY."

        rlm = RLM(
            environment="local",
            verbose=True,
            max_iterations=args.max_iterations,
            backend_kwargs={"model_name": "gpt-5.4-2026-03-05"},
            environment_kwargs={},
            custom_tools={"trellis_neo4j": neo4j_tool, "trellis_postgres": postgres_tool},
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
            "execution_time_s": getattr(result, "execution_time", None),
            "model_usage": usage_dict.get("model_usage_summaries", {}),
        }
        print(f"TRELLIS_TELEMETRY: {json.dumps(telemetry_payload)}", flush=True)

        if get_tool_call_count() == 0:
            # The agent answered without touching either database — the
            # answer has no provenance and the runner should re-dispatch.
            print("TRELLIS_PROTOCOL_VIOLATION: zero database tool calls — answer has no provenance.", flush=True)

    except BaseException as e:
        import traceback
        print(f"RLM Execution Error: {type(e).__name__} - {str(e)}", flush=True)
        traceback.print_exc()
        exit_code = 1
    finally:
        neo4j_tool.close()
        postgres_tool.close()

    sys.exit(exit_code)

if __name__ == "__main__":
    main()
