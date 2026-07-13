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
# file the task did not name (the checker must flag it). The tool
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
from trellis_textedit import TrellisTextEdit  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Stage-2 self-edit rehearsal")
    parser.add_argument("--mode", choices=["clean", "violation"], required=True)
    parser.add_argument("--edit-root", required=True)
    parser.add_argument("--target-entity", required=True,
                        help="Fixture entity whose ACTION provenance the rehearsal reads")
    parser.add_argument("--block-hash", required=True,
                        help="The fixture block hash the rehearsal fetches and cites")
    parser.add_argument("--off-hash", required=True,
                        help="A real-but-unfetched hash the violation arm tries to cite")
    parser.add_argument("--subject", required=True)
    parser.add_argument("--object", required=True)
    args = parser.parse_args()

    result = {
        "mode": args.mode,
        "cypher_hashes": [],
        "fetched": False,
        "gate_refusal": None,
        "insight_written": False,
        "writes": [],
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

        # 3. The edit, through the toolkit only.
        editor.load("notes.txt")
        located = json.loads(editor.locate("notes.txt", "STALE:"))
        hit = located["hits"][0]["line"]
        editor.splice("notes.txt", hit, hit + 1,
                      ["CORRECTED: slice (d) is live; the write gate consumes the set."])
        editor.write_back("notes.txt")
        result["writes"].append("notes.txt")

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
