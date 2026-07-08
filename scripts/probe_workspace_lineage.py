# The Session 16 follow-up to the design-record §11 step-1 probe: the
# paired protocol across a TWO-TASK goal, measuring whether SEEDED
# workspaces (design record §5 lineage) eliminate cross-task
# re-derivation. PAID: makes real LLM calls (owner approved). Not part of
# any acceptance suite; run via `tsx scripts/probe_workspace_lineage.ts`.
#
# Protocol. One upstream task (task 1) runs ONCE: it fetches four
# archive_search results into a Tier-3 workspace and answers their access
# codes, producing an end-of-run snapshot. Then one dependent task
# (task 2) runs TWICE, identical in every respect except lineage:
#
#   - SEEDED arm  — task 2's workspace is built with the REAL
#     TrellisWorkspace.seed_from_snapshot() from task 1's snapshot, and
#     the SEEDED RUN addendum is composed into the prompt (exactly what
#     the worker does when it passes --seed-workspace). Task 2 already
#     holds task 1's four segments; it should read them and answer with
#     ZERO further external calls.
#   - UNSEEDED arm — task 2 gets a fresh goal workspace, no seed, no
#     seeded addendum. The sub-agent shares no context with task 1 (the
#     orchestrator's transcript is the only cross-task channel, and it is
#     not given to the sub-agent), so to obtain the codes it must
#     re-call archive_search for each of the four queries.
#
# Running task 1 once means both task-2 arms face identical upstream
# state (the same snapshot for the seeded arm, nothing for the unseeded
# arm), so the ONLY variable is seeding — the single-task probe's
# isolate-one-variable design, lifted to the cross-task level. The
# snapshot()->seed_from_snapshot() seam is the actual lineage mechanism;
# the worker's Redis park/seed is transport around it (already covered
# zero-paid by test:agent-loop), so this probe exercises the seam
# in-process.
#
# Measured per run: mcp_calls, database tool calls, tokens/cost, exec
# time, answer correctness against the precomputed codes. Cross-task
# re-derivation is task 2's mcp_calls (in the unseeded arm those calls
# re-do task 1's work); the goal-total external calls are task1 + task2.
# The seeded arm additionally records its INHERITED workspace's
# well-formedness before task 2 runs (four segments, task-1 stamps
# preserved) and whether task 2 read segments rather than re-fetching.
import hashlib
import json
import os
import re
import sys
import uuid as uuid_module

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))

from rlm import RLM  # noqa: E402
import trellis_tools  # noqa: E402
import trellis_mcp  # noqa: E402
from trellis_tools import TrellisNeo4j, TrellisPostgres  # noqa: E402
from trellis_mcp import TrellisMcp, parse_mcp_config, build_mcp_addendum  # noqa: E402
from trellis_workspace import (  # noqa: E402
    TrellisWorkspace,
    build_workspace_addendum,
    parse_workspace_bounds,
)
from trellis_agent import SYSTEM_PROMPT  # noqa: E402

QUERIES = ["alpha provenance", "beta lineage", "gamma modules", "delta flywheel"]
EXPECTED = [hashlib.sha256(q.encode("utf-8")).hexdigest()[:12] for q in QUERIES]
MAX_ITERATIONS = 8
GOAL_ID = "probe-lineage"

# Task 1: fetch the four results into the workspace and answer the codes.
TASK1 = (
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

# Task 2: identical text in both arms. Phrased as a goal ("obtain and
# report"), NOT as an explicit fetch instruction, so each arm reaches the
# codes however it can — the seeded arm from inherited segments, the
# unseeded arm by re-fetching. The four queries are restated because the
# sub-agent shares no context with task 1 (the orchestrator would restate
# them too).
TASK2 = (
    "You are continuing a goal whose earlier task already researched an external "
    "'archive' MCP server (tool archive_search). You need the 'access_code' for each of "
    "these four archive queries, in this exact order: "
    + ", ".join(f"'{q}'" for q in QUERIES) + ". "
    "Obtain the four access codes and also execute exactly one graph query "
    "(trellis_neo4j.run_cypher('MATCH (n) RETURN count(n) AS c')) so the answer has "
    "database provenance. Do not do redundant external work. "
    "Respond with FINAL_ANSWER: followed by the four access codes joined by commas, no spaces."
)


def reset_counters():
    trellis_tools._tool_call_stats["count"] = 0
    trellis_mcp._mcp_call_stats["count"] = 0


def snapshot_wellformed(workspace):
    """Structural check on a workspace snapshot: four archive segments,
    uuid ids, wrapper-owned stamps, and every code present in content."""
    snapshot = json.loads(workspace.snapshot())
    segments = snapshot.get("segments", {})
    origins_ok = all(
        set(seg.get("origin", {})) == {"server", "tool", "argsHash"}
        and seg["origin"]["server"] == "archive"
        and re.match(r"^[0-9a-f]{16}$", seg["origin"]["argsHash"])
        and re.match(r"^\d{4}-\d{2}-\d{2}T", seg.get("fetchedAt", ""))
        for seg in segments.values()
    )
    ids_ok = all(str(uuid_module.UUID(sid)) == sid for sid in segments)
    codes_in_content = all(
        any(code in seg.get("content", "") for seg in segments.values())
        for code in EXPECTED
    )
    return {
        "segment_count": len(segments),
        "uuid_ids": ids_ok,
        "origin_stamps": origins_ok,
        "all_codes_captured": codes_in_content,
    }


def run_task(label, task_text, servers, workspace, seeded):
    """Runs one RLM completion against an already-constructed workspace
    (or None), returning the measurement plus the workspace so the caller
    can snapshot it. Mirrors trellis_agent's prompt composition exactly."""
    reset_counters()
    postgres_tool = TrellisPostgres()
    neo4j_tool = TrellisNeo4j(ast_existence_check=postgres_tool.ast_hashes_exist)
    custom_tools = {"trellis_neo4j": neo4j_tool, "trellis_postgres": postgres_tool}
    if workspace is not None:
        custom_tools["trellis_workspace"] = workspace
    mcp_tool = TrellisMcp(servers, workspace=workspace)
    custom_tools["trellis_mcp"] = mcp_tool

    safe_query = task_text.replace("{", "{{").replace("}", "}}")
    prompt = (
        SYSTEM_PROMPT
        + build_mcp_addendum(servers)
        + build_workspace_addendum(workspace, seeded=seeded)
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
        result = rlm.completion(task_text)
        response = getattr(result, "response", None) or str(result)
        usage = getattr(result, "usage_summary", None)

        marker = "FINAL_ANSWER:"
        answer = response.rsplit(marker, 1)[-1].strip() if marker in response else response.strip()
        codes = [c.strip() for c in answer.split(",")] if answer else []

        return {
            "run": label,
            "seeded": seeded,
            "answer": answer,
            "correct": codes == EXPECTED,
            "mcp_calls": trellis_mcp.get_mcp_call_count(),
            "db_tool_calls": trellis_tools.get_tool_call_count(),
            "input_tokens": usage.total_input_tokens if usage else None,
            "output_tokens": usage.total_output_tokens if usage else None,
            "reported_cost_usd": usage.total_cost if usage else None,
            "execution_time_s": getattr(result, "execution_time", None),
            "workspace_stats": workspace.stats() if workspace is not None else None,
        }
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
    max_segments, max_bytes = parse_workspace_bounds()

    print(f"Expected codes: {','.join(EXPECTED)}\n", flush=True)

    # --- Task 1 (upstream, runs once) --------------------------------------
    print("\n================ TASK 1 (upstream: fetch + park) ================\n", flush=True)
    task1_ws = TrellisWorkspace(max_segments=max_segments, max_bytes=max_bytes,
                                goal_id=GOAL_ID, task_id="task-1")
    task1 = run_task("task-1", TASK1, servers, task1_ws, seeded=False)
    task1["end_of_run_workspace"] = snapshot_wellformed(task1_ws)
    upstream_snapshot = json.loads(task1_ws.snapshot())

    # --- Task 2, SEEDED arm ------------------------------------------------
    print("\n================ TASK 2 — SEEDED arm ================\n", flush=True)
    seeded_ws = TrellisWorkspace.seed_from_snapshot(
        upstream_snapshot, max_segments=max_segments, max_bytes=max_bytes,
        goal_id=GOAL_ID, task_id="task-2-seeded")
    inherited = snapshot_wellformed(seeded_ws)  # BEFORE task 2 runs
    seeded = run_task("task-2-seeded", TASK2, servers, seeded_ws, seeded=True)
    seeded["inherited_workspace"] = inherited
    seeded["end_of_run_segment_count"] = len(json.loads(seeded_ws.snapshot())["segments"])

    # --- Task 2, UNSEEDED arm ----------------------------------------------
    print("\n================ TASK 2 — UNSEEDED arm ================\n", flush=True)
    unseeded_ws = TrellisWorkspace(max_segments=max_segments, max_bytes=max_bytes,
                                   goal_id=GOAL_ID, task_id="task-2-unseeded")
    unseeded = run_task("task-2-unseeded", TASK2, servers, unseeded_ws, seeded=False)
    unseeded["end_of_run_segment_count"] = len(json.loads(unseeded_ws.snapshot())["segments"])

    goal_totals = {
        "seeded_goal_mcp_calls": task1["mcp_calls"] + seeded["mcp_calls"],
        "unseeded_goal_mcp_calls": task1["mcp_calls"] + unseeded["mcp_calls"],
        "cross_task_rederivation_seeded": seeded["mcp_calls"],
        "cross_task_rederivation_unseeded": unseeded["mcp_calls"],
    }

    payload = {
        "expected_codes": EXPECTED,
        "task1": task1,
        "task2_seeded": seeded,
        "task2_unseeded": unseeded,
        "goal_totals": goal_totals,
    }
    print("\nTRELLIS_LINEAGE_PROBE_RESULTS: " + json.dumps(payload, indent=2), flush=True)


if __name__ == "__main__":
    main()
