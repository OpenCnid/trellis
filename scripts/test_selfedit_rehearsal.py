# Session 35 (REPOSITORY_INGESTION_REPORT.md §5e.3): the scripted
# stage-2 rehearsal — drives the run's REAL tool sequence zero-LLM,
# spawned by scripts/test_selfedit_harness.ts against the drill's
# token-scoped fixture:
#
#   run_cypher (provenance references) -> get_ast_texts (bytes, joins
#   the retrieval set) -> trellis_textedit load/locate/splice/
#   write_back -> the retrieval-gated write_derived_insight ->
#   REHEARSAL_RESULT.
#
# The clean arm edits only the named file and cites only the fetched
# hash: the live Session 31 gate passes and the checker must report
# zero findings. The violation arm plants both halves of the named
# failure mode: it first attempts to cite a hash it never fetched
# (the live gate must refuse — observed, not simulated), then edits a
# file the task did not name (the checker must flag it). The guarded
# arm (Session 41, STRUCTURAL_SPLICE.md §6 item 4) drives the same
# real sequence through the guarded splice family: one OBSERVED
# AnchorMismatchError refusal (a retyped-from-memory expected line),
# the taught self-correction (re-read, then the minimal verified
# replace), write_back, and the gated write. Session 50
# (RLM_HARNESS_SCAFFOLDING.md): the guarded arm additionally drives
# the scaffolds — the trellis_task surface (grep over the task text),
# region_equal verification through the staged helpers, and the
# citable() probe BEFORE the insight write, reporting per-hash
# classifications the harness cross-checks against the TypeScript
# gatherHashEvidence on the same fixture (the mirror pin). The tool
# construction mirrors trellis_agent.py research wiring: a
# discipline-enabled TrellisPostgres and a TrellisNeo4j carrying both
# the existence check and the retrieved_addresses_check seam.
import argparse
import json
import os
import sys

RLM_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm")
sys.path.insert(0, RLM_DIR)
from trellis_tools import (  # noqa: E402
    TrellisNeo4j,
    TrellisPostgres,
    get_retrieved_addresses,
)
from trellis_scaffold import TrellisTask, build_scaffold_helpers  # noqa: E402
from trellis_textedit import AnchorMismatchError, TrellisTextEdit  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Stage-2 self-edit rehearsal")
    parser.add_argument("--mode", choices=["clean", "violation", "guarded"], required=True)
    parser.add_argument("--edit-root", required=True)
    parser.add_argument("--target-entity", required=True,
                        help="Fixture entity whose ACTION provenance the rehearsal reads")
    parser.add_argument("--block-hash", required=True,
                        help="The fixture block hash the rehearsal fetches and cites")
    parser.add_argument("--off-hash", required=True,
                        help="A real-but-unfetched hash the violation arm tries to cite")
    parser.add_argument("--dead-hash", default=None,
                        help="Guarded arm: a superseded fixture hash for the citable probe")
    parser.add_argument("--ghost-hash", default=None,
                        help="Guarded arm: a never-inserted hash for the citable probe")
    parser.add_argument("--doc-prefix", default=None,
                        help="Guarded arm: the fixture doc-key prefix the citable probe bridges against")
    parser.add_argument("--subject", required=True)
    parser.add_argument("--object", required=True)
    args = parser.parse_args()

    result = {
        "mode": args.mode,
        "cypher_hashes": [],
        "fetched": False,
        "gate_refusal": None,
        "anchor_refusal": None,
        "guarded_ops": 0,
        "raw_splices": 0,
        "insight_written": False,
        "writes": [],
        "task_grep_total": None,
        "region_verified": None,
        "citable_report": None,
    }

    pg = TrellisPostgres(retrieval_discipline=True)
    client = TrellisNeo4j(
        ast_existence_check=pg.ast_hashes_exist,
        retrieved_addresses_check=get_retrieved_addresses,
    )
    editor = TrellisTextEdit(args.edit_root)
    try:
        # 1. Graph first: the provenance hashes are REFERENCES until the
        #    bytes are fetched (the Session 30/31 taught pattern).
        rows = json.loads(client.run_cypher(
            "MATCH (e:Entity {name: '" + args.target_entity + "'})-[r:ACTION]-() "
            "RETURN r.sourceNodeIds AS sourceNodeIds"
        ))
        for row in rows:
            for h in row.get("sourceNodeIds") or []:
                if h not in result["cypher_hashes"]:
                    result["cypher_hashes"].append(h)

        # 2. Fetch the cited bytes — this is what joins the retrieval set.
        texts = json.loads(pg.get_ast_texts([args.block_hash]))
        result["fetched"] = args.block_hash in texts

        # 3. The edit, through the toolkit only. The guarded arm also
        #    constructs the Session 50 scaffolds exactly the way
        #    trellis_agent.py does (the factory, gated by what the run
        #    has), and re-reads its task by code first.
        scaffold = {}
        if args.mode == "guarded":
            task = TrellisTask(
                "Correct the STALE line in notes.txt through the guarded "
                "family; cite only fetched notes.txt blocks.",
                "rehearsal-uuid",
            )
            result["task_grep_total"] = json.loads(task.grep("notes.txt"))["totalHits"]
            scaffold = build_scaffold_helpers(
                textedit=editor,
                postgres=pg,
                retrieved_addresses_fn=get_retrieved_addresses,
                named_files=["notes.txt"],
                doc_key_prefix=args.doc_prefix or "",
            )
        editor.load("notes.txt")
        located = json.loads(editor.locate("notes.txt", "STALE:"))
        hit = located["hits"][0]["line"]
        corrected = "CORRECTED: slice (d) is live; the write gate consumes the set."
        if args.mode == "guarded":
            # 3a. The guarded arm: FIRST a retyped-from-memory expected
            #     line — the live AnchorMismatchError refusal, observed,
            #     never simulated (the Session 36 run-1 class refused at
            #     the call site).
            try:
                editor.replace_lines(
                    "notes.txt", hit, hit + 1,
                    ["STALE: slice (d) would constrain this set; nothing reads it."],
                    [corrected],
                )
                result["anchor_refusal"] = "MISSING: the guard accepted diverged bytes"
            except AnchorMismatchError as e:
                result["anchor_refusal"] = str(e)
            # 3b. The taught self-correction: re-READ the actual line,
            #     then the minimal verified replacement.
            actual = json.loads(editor.lines("notes.txt", hit, hit + 1))["lines"][0][1]
            editor.replace_lines("notes.txt", hit, hit + 1, [actual], [corrected])
        else:
            editor.splice("notes.txt", hit, hit + 1, [corrected])
        editor.write_back("notes.txt")
        stats = editor.stats()
        result["guarded_ops"] = stats["textedit_guarded_ops"]
        result["raw_splices"] = stats["textedit_raw_splices"]
        result["writes"].append("notes.txt")

        if args.mode == "guarded":
            # The Session 50 verification discipline: the edited region
            # asserted as a LIST through the staged helper, never a
            # terminator-less substring check.
            result["region_verified"] = scaffold["region_equal"](
                "notes.txt", hit, [corrected])
            # The citable() probe BEFORE the insight write — per-hash
            # classifications the harness mirror-pins against the
            # TypeScript gatherHashEvidence over the same fixture.
            probe_hashes = [args.block_hash, args.off_hash]
            for extra in (args.dead_hash, args.ghost_hash):
                if extra:
                    probe_hashes.append(extra)
            result["citable_report"] = scaffold["citable"](probe_hashes)

        if args.mode == "violation":
            # 4a. Cite a hash this run never fetched: the live gate must
            #     refuse (observed refusal, never simulated).
            try:
                client.write_derived_insight(
                    args.subject, "consumes", args.object,
                    [args.block_hash, args.off_hash],
                )
                result["gate_refusal"] = "MISSING: the gate accepted an unretrieved citation"
            except ValueError as e:
                result["gate_refusal"] = str(e)
            # 4b. Edit a file the task did not name — the checker's half.
            editor.load("other.txt")
            editor.splice("other.txt", 0, 0, ["out-of-scope line the task never asked for"])
            editor.write_back("other.txt")
            result["writes"].append("other.txt")

        # 5. The recorded evidence edge (both arms), citing only fetched
        #    bytes — passes the gate.
        client.write_derived_insight(
            args.subject, "consumes", args.object, [args.block_hash],
        )
        result["insight_written"] = True
    finally:
        client.close()
        pg.close()

    print("REHEARSAL_RESULT: " + json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
