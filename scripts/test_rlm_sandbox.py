# Live test of the RLM sandbox's read-only enforcement (T7), run against
# the docker-compose Neo4j via `npm run test:rlm-sandbox`.
#
# The critical check is #3: `CALL db.createLabel(...)` is a genuine write
# whose procedure name contains no blocklisted keyword with a word
# boundary (\bCREATE\b does not match CREATELABEL), so it sails past the
# regex courtesy check — only the transport-level READ access mode stops
# it. Before T7 this probe mutated the graph.
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))
from trellis_tools import TrellisNeo4j  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        failures += 1


client = TrellisNeo4j()
try:
    # 1. Reads still work through the READ-mode session.
    res = json.loads(client.run_cypher("MATCH (n) RETURN count(n) AS c"))
    check("read query executes in READ-mode session", isinstance(res, list) and "c" in res[0])

    # 2. The keyword blocklist still fast-fails obvious mutations.
    try:
        client.run_cypher("CREATE (x:SandboxProbe)")
        check("blocklist rejects CREATE", False, "mutation was accepted")
    except ValueError:
        check("blocklist rejects CREATE", True)

    # 3. A keyword-evading write procedure must be rejected SERVER-side.
    try:
        client.run_cypher("CALL db.createLabel('SandboxProbe')")
        check("READ session blocks keyword-evading write procedure", False,
              "db.createLabel executed — transport enforcement is NOT active")
    except ValueError as e:
        check("READ session blocks keyword-evading write procedure", False,
              f"probe unexpectedly caught by the blocklist, not the server: {e}")
    except RuntimeError as e:
        detail = str(e)
        server_side = "read" in detail.lower() or "write" in detail.lower()
        check("READ session blocks keyword-evading write procedure", server_side, detail[:200])

    # 4. The whitelisted write path is unaffected.
    out = json.loads(client.write_derived_insight(
        "sandbox probe subject", "mentions", "sandbox probe object", ["sandbox-test-hash"]))
    check("write_derived_insight still writes (WRITE session)",
          bool(out) and out[0].get("verb") == "mentions")

    # Cleanup of the probe fact — the test owns a direct write session;
    # this is not the sandbox path.
    with client.driver.session() as s:
        s.run(
            "MATCH (n:Entity) WHERE n.name IN ['sandbox probe subject', 'sandbox probe object'] "
            "DETACH DELETE n"
        )
finally:
    client.close()

if failures:
    print(f"\n{failures} check(s) failed.")
    sys.exit(1)
print("\nAll sandbox checks passed.")
