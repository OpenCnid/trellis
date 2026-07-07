# The design-record §11 step-1 paired-run behavioral probe. PAID: makes
# real LLM calls (owner approved, July 7, 2026 — PR #40 discussion). Not
# part of any acceptance suite; run via `tsx scripts/probe_workspace_paired.ts`.
#
# Protocol: one sequential multi-step task, two runs identical except for
# the Tier-3 workspace — run A has the workspace attached to the MCP
# client (capture + stub returns + addendum), run B is the pre-Session-14
# surface (full results into scrollback, no addendum). The only external
# server is the local deterministic fixture; each archive_search result
# is ~2.8 KB with the needed access_code at the END, past the 500-char
# stub preview, so run A must read stored segments to answer.
#
# Measured per run: mcp_calls (minimum 4 — repeats indicate lost
# results), database tool calls, tokens and reported cost, answer
# correctness against the precomputed codes, and (run A) end-of-run
# workspace well-formedness (snapshot parses; four segments; uuid ids;
# wrapper-owned origin stamps; contents carry the codes).
import hashlib
import json
import os
import re
import sys
import uuid as uuid_module

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))

from rlm import RLM  # noqa: E402
from rlm.utils.prompts import RLM_SYSTEM_PROMPT  # noqa: E402
import trellis_tools  # noqa: E402
import trellis_mcp  # noqa: E402
from trellis_tools import TrellisNeo4j, TrellisPostgres  # noqa: E402
from trellis_mcp import TrellisMcp, parse_mcp_config, build_mcp_addendum  # noqa: E402
from trellis_workspace import TrellisWorkspace, build_workspace_addendum, parse_workspace_bounds  # noqa: E402
from trellis_agent import SYSTEM_PROMPT  # noqa: E402

QUERIES = ["alpha provenance", "beta lineage", "gamma modules", "delta flywheel"]
EXPECTED = [hashlib.sha256(q.encode("utf-8")).hexdigest()[:12] for q in QUERIES]
MAX_ITERATIONS = 8

TASK = (
    "You have an external MCP server named 'archive' with one tool, archive_search. "
    "For EACH of these four queries, in this exact order, call "
    "trellis_mcp.call_tool('archive', 'archive_search', dict(query=q)) exactly once: "
    + ", ".join(f"'{q}'" for q in QUERIES) + ". "
    "Each result is a JSON document containing an 'access_code' field; collect the four "
    "access codes in query order. Also execute exactly one graph query "
    "(trellis_neo4j.run_cypher('MATCH (n) RETURN count(n) AS c')) so the answer has "
    "database provenance. Respond with FINAL_ANSWER: followed by the four access codes "
    "joined by commas, no spaces."
)


def reset_counters():
    trellis_tools._tool_call_stats["count"] = 0
    trellis_mcp._mcp_call_stats["count"] = 0


def run_once(label, servers, with_workspace):
    reset_counters()
    postgres_tool = TrellisPostgres()
    neo4j_tool = TrellisNeo4j(ast_existence_check=postgres_tool.ast_hashes_exist)
    workspace = None
    custom_tools = {"trellis_neo4j": neo4j_tool, "trellis_postgres": postgres_tool}
    if with_workspace:
        max_segments, max_bytes = parse_workspace_bounds()
        workspace = TrellisWorkspace(max_segments=max_segments, max_bytes=max_bytes,
                                     goal_id="probe-paired")
        custom_tools["trellis_workspace"] = workspace
    mcp_tool = TrellisMcp(servers, workspace=workspace)
    custom_tools["trellis_mcp"] = mcp_tool

    safe_query = TASK.replace("{", "{{").replace("}", "}}")
    prompt = (
        SYSTEM_PROMPT
        + build_mcp_addendum(servers)
        + build_workspace_addendum(workspace)
        + f"\n\nTHE USER'S QUERY IS: {safe_query}\nDO NOT ASK FOR A QUERY, THIS IS IT. EXECUTE IT IMMEDIATELY."
    )

    try:
        rlm = RLM(
            environment="local",
            verbose=True,
            max_iterations=MAX_ITERATIONS,
            backend_kwargs={"model_name": "gpt-5.4-2026-03-05"},
            environment_kwargs={},
            custom_tools=custom_tools,
            custom_system_prompt=prompt,
        )
        result = rlm.completion(TASK)
        response = getattr(result, "response", None) or str(result)
        usage = getattr(result, "usage_summary", None)

        marker = "FINAL_ANSWER:"
        answer = response.rsplit(marker, 1)[-1].strip() if marker in response else response.strip()
        codes = [c.strip() for c in answer.split(",")] if answer else []

        measurement = {
            "run": label,
            "workspace": with_workspace,
            "answer": answer,
            "correct": codes == EXPECTED,
            "mcp_calls": trellis_mcp.get_mcp_call_count(),
            "db_tool_calls": trellis_tools.get_tool_call_count(),
            "repeated_mcp_calls": max(0, trellis_mcp.get_mcp_call_count() - len(QUERIES)),
            "input_tokens": usage.total_input_tokens if usage else None,
            "output_tokens": usage.total_output_tokens if usage else None,
            "reported_cost_usd": usage.total_cost if usage else None,
            "execution_time_s": getattr(result, "execution_time", None),
        }

        if with_workspace:
            snapshot = json.loads(workspace.snapshot())
            segments = snapshot.get("segments", {})
            origins_ok = all(
                set(seg.get("origin", {})) == {"server", "tool", "argsHash"}
                and seg["origin"]["server"] == "archive"
                and re.match(r"^[0-9a-f]{16}$", seg["origin"]["argsHash"])
                and re.match(r"^\d{4}-\d{2}-\d{2}T", seg.get("fetchedAt", ""))
                and seg.get("goalId") == "probe-paired"
                for seg in segments.values()
            )
            ids_ok = all(str(uuid_module.UUID(sid)) == sid for sid in segments)
            codes_in_content = all(
                any(code in seg.get("content", "") for seg in segments.values())
                for code in EXPECTED
            )
            measurement["workspace_wellformed"] = {
                "snapshot_parses": True,
                "segment_count": len(segments),
                "uuid_ids": ids_ok,
                "origin_stamps": origins_ok,
                "all_codes_captured": codes_in_content,
                "stats": workspace.stats(),
            }
        return measurement
    finally:
        mcp_tool.close()
        neo4j_tool.close()
        postgres_tool.close()


def main():
    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is not set; this probe is paid and cannot run.", file=sys.stderr)
        sys.exit(2)
    servers = parse_mcp_config(os.environ.get("TRELLIS_MCP_SERVERS"))
    if not servers or servers[0]["name"] != "archive":
        print("Expected the wrapper-forwarded 'archive' fixture registry.", file=sys.stderr)
        sys.exit(2)

    print(f"Expected codes: {','.join(EXPECTED)}\n", flush=True)
    results = []
    for label, with_workspace in (("A-workspace", True), ("B-legacy", False)):
        print(f"\n================ RUN {label} ================\n", flush=True)
        results.append(run_once(label, servers, with_workspace))

    print("\nTRELLIS_PROBE_RESULTS: " + json.dumps(results, indent=2), flush=True)


if __name__ == "__main__":
    main()
