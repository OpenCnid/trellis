# Helper for scripts/test_promotion.ts: one write_derived_insight attempt
# through the REAL hardened write path (trellis_tools.py, with the
# ast_hashes_exist existence check wired exactly as trellis_agent.py
# wires it). Called twice by the promotion drill:
#
#   reject  — before promotion: citing the would-be block hash must raise
#             a Provenance Violation (the hash is not verified substrate
#             yet, however well-formed it is);
#   write   — after promotion: citing the SAME hash must succeed (earned
#             citability, end to end).
#
# Usage: test_promotion_write.py <reject|write> <subject> <verb> <obj> <hash>...
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))
from trellis_tools import TrellisNeo4j, TrellisPostgres  # noqa: E402

mode, subject, verb, obj = sys.argv[1:5]
hashes = sys.argv[5:]

pg = TrellisPostgres()
client = TrellisNeo4j(ast_existence_check=pg.ast_hashes_exist)
try:
    if mode == "reject":
        try:
            client.write_derived_insight(subject, verb, obj, hashes)
            print("WROTE (expected a Provenance Violation)")
            sys.exit(1)
        except ValueError as e:
            if "Provenance Violation" in str(e):
                print("REJECTED")
                sys.exit(0)
            print(f"WRONG_ERROR: {e}")
            sys.exit(1)
    elif mode == "write":
        out = json.loads(client.write_derived_insight(subject, verb, obj, hashes))
        if out and out[0].get("verb") == verb:
            print("WROTE")
            sys.exit(0)
        print(f"UNEXPECTED_RESULT: {out}")
        sys.exit(1)
    else:
        print(f"unknown mode {mode!r}")
        sys.exit(2)
finally:
    pg.close()
    client.close()
