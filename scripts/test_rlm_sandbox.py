# Live test of the RLM sandbox's read-only enforcement (T7) and the
# Session 14 write-path provenance hardening, run against the
# docker-compose stack via `npm run test:rlm-sandbox`.
#
# The critical T7 check is #3: `CALL db.createLabel(...)` is a genuine
# write whose procedure name contains no blocklisted keyword with a word
# boundary (\bCREATE\b does not match CREATELABEL), so it sails past the
# regex courtesy check — only the transport-level READ access mode stops
# it. Before T7 this probe mutated the graph.
#
# The Session 14 checks pin the two hardening layers at the single write
# path: `sourceNodeIds` elements must match ^[0-9a-f]{64}$, and the
# deduped union of a batch's hashes must exist in ast_nodes before the
# WRITE session opens. The probe AST row is token-scoped: inserted by
# this test, deleted by this test.
import hashlib
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))
from trellis_tools import TrellisNeo4j, TrellisPostgres, get_tool_call_count  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        failures += 1


def expect_provenance_violation(name, fn, needle):
    try:
        fn()
        check(name, False, "expected a Provenance Violation, nothing raised")
    except ValueError as e:
        message = str(e)
        check(name, "Provenance Violation" in message and needle.lower() in message.lower(),
              f"message lacked {needle!r}: {message[:200]}")
    except Exception as e:  # noqa: BLE001
        check(name, False, f"expected ValueError, got {type(e).__name__}: {e}")


# The probe AST row this test owns: a real 64-lowercase-hex id present in
# ast_nodes for the duration of the run, so "real ingested hash still
# writes" is deterministic on any stack, empty or not.
PROBE_HASH = hashlib.sha256(b"trellis-sandbox-hardening-probe-v1").hexdigest()

pg = TrellisPostgres()
client = TrellisNeo4j(ast_existence_check=pg.ast_hashes_exist)  # the trellis_agent.py wiring
try:
    with pg.conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ast_nodes (id, document_id, data) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING",
            (PROBE_HASH, "sandbox_probe_doc", json.dumps({"type": "text", "content": "sandbox hardening probe"})),
        )
    pg.conn.commit()

    # --- T7: read-only enforcement (pre-Session-14 checks, unchanged) ---
    print("\n[1] T7 read-only enforcement")

    res = json.loads(client.run_cypher("MATCH (n) RETURN count(n) AS c"))
    check("read query executes in READ-mode session", isinstance(res, list) and "c" in res[0])

    try:
        client.run_cypher("CREATE (x:SandboxProbe)")
        check("blocklist rejects CREATE", False, "mutation was accepted")
    except ValueError:
        check("blocklist rejects CREATE", True)

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

    # --- Session 14: hash format enforcement at _normalize_fact ---------
    print("\n[2] sourceNodeIds format enforcement")

    def write_with(hashes):
        return lambda: client.write_derived_insight(
            "sandbox probe subject", "mentions", "sandbox probe object", hashes)

    expect_provenance_violation("uppercase hex rejected", write_with([PROBE_HASH.upper()]), "not an AST hash")
    expect_provenance_violation("63-char hash rejected", write_with([PROBE_HASH[:63]]), "not an AST hash")
    expect_provenance_violation("uuid-shaped id rejected", write_with([str(uuid.uuid4())]), "not an AST hash")
    expect_provenance_violation("question id rejected", write_with(["q_0001"]), "not an AST hash")
    expect_provenance_violation("non-string element rejected", write_with([12345]), "not an AST hash")
    expect_provenance_violation(
        "oversized garbage is echoed bounded",
        write_with(["z" * 500]),
        "...",
    )
    # A malformed hash in a bulk batch rejects the WHOLE batch before any
    # session opens — even when other facts in the batch are clean.
    expect_provenance_violation(
        "bulk batch with one malformed hash rejects everything",
        lambda: client.write_derived_insights([
            dict(subject="sandbox probe subject", verb="mentions", obj="sandbox probe object",
                 sourceNodeIds=[PROBE_HASH]),
            dict(subject="sandbox probe subject", verb="mentions", obj="sandbox probe object",
                 sourceNodeIds=["q_0002"]),
        ]),
        "not an AST hash",
    )

    # --- Session 14: existence enforcement before the WRITE session -----
    print("\n[3] ast_nodes existence enforcement")

    check("ast_hashes_exist reports the probe hash as present",
          json.loads(pg.ast_hashes_exist([PROBE_HASH])) == [])
    unknown = hashlib.sha256(b"trellis-sandbox-unknown-source").hexdigest()
    check("ast_hashes_exist reports an unknown hash as missing",
          json.loads(pg.ast_hashes_exist([unknown])) == [unknown])
    check("ast_hashes_exist handles the empty list without a round trip",
          pg.ast_hashes_exist([]) == "[]")

    expect_provenance_violation(
        "well-formed-but-unknown hash rejected",
        write_with([unknown]),
        unknown,
    )
    many_unknown = [hashlib.sha256(f"unknown-{i}".encode()).hexdigest() for i in range(7)]
    expect_provenance_violation(
        "unknown-hash list in the error is bounded (first 5 + count)",
        write_with(many_unknown),
        "+2 more",
    )
    expect_provenance_violation(
        "mixed known/unknown provenance rejects the write entirely",
        write_with([PROBE_HASH, unknown]),
        unknown,
    )

    tool_calls_before = get_tool_call_count()
    pg.ast_hashes_exist([PROBE_HASH])
    check("ast_hashes_exist never increments the database tool-call count",
          get_tool_call_count() == tool_calls_before)

    # Infrastructure failure is a RuntimeError, never a provenance verdict.
    def infra_failure(hashes):
        raise RuntimeError("simulated infrastructure failure")

    broken_checker = TrellisNeo4j(ast_existence_check=infra_failure)
    try:
        broken_checker.write_derived_insight(
            "sandbox probe subject", "mentions", "sandbox probe object", [PROBE_HASH])
        check("checker infrastructure failure propagates as RuntimeError", False, "nothing raised")
    except RuntimeError as e:
        check("checker infrastructure failure propagates as RuntimeError",
              "Provenance Violation" not in str(e))
    except Exception as e:  # noqa: BLE001
        check("checker infrastructure failure propagates as RuntimeError", False,
              f"got {type(e).__name__}: {e}")
    finally:
        broken_checker.close()

    # --- Session 14: the write path still writes with real provenance ---
    print("\n[4] whitelisted write path with verified provenance")

    out = json.loads(client.write_derived_insight(
        "sandbox probe subject", "mentions", "sandbox probe object", [PROBE_HASH]))
    check("write_derived_insight writes with a real ingested hash (WRITE session)",
          bool(out) and out[0].get("verb") == "mentions")

    # The bulk variant verifies the DEDUPED union exactly once.
    existence_calls = []

    def counting_checker(hashes):
        existence_calls.append(list(hashes))
        return pg.ast_hashes_exist(hashes)

    counting_client = TrellisNeo4j(ast_existence_check=counting_checker)
    try:
        bulk = json.loads(counting_client.write_derived_insights([
            dict(subject="sandbox probe subject", verb="mentions", obj="sandbox probe object",
                 sourceNodeIds=[PROBE_HASH]),
            dict(subject="sandbox probe subject", verb="mentions", obj="sandbox bulk object",
                 sourceNodeIds=[PROBE_HASH, PROBE_HASH]),
        ]))
        check("bulk write succeeds with verified provenance", len(bulk) == 2)
        check("bulk variant checks existence exactly once for the deduped union",
              existence_calls == [[PROBE_HASH]])
    finally:
        counting_client.close()

    # Cleanup of the probe facts — the test owns a direct write session;
    # this is not the sandbox path.
    with client.driver.session() as s:
        s.run(
            "MATCH (n:Entity) WHERE n.name IN "
            "['sandbox probe subject', 'sandbox probe object', 'sandbox bulk object'] "
            "DETACH DELETE n"
        )
finally:
    try:
        with pg.conn.cursor() as cur:
            cur.execute("DELETE FROM ast_nodes WHERE id = %s", (PROBE_HASH,))
        pg.conn.commit()
    finally:
        pg.close()
        client.close()

if failures:
    print(f"\n{failures} check(s) failed.")
    sys.exit(1)
print("\nAll sandbox checks passed.")
