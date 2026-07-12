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
# WRITE session opens. Section [5] pins the Session 30 retrieval-set
# tracking; section [6] pins the Session 31 retrieval-membership write
# gate (PROVENANCE_THREADING.md slice d) on top of it. Probe AST rows
# are token-scoped: inserted by this test, deleted by this test.
import hashlib
import json
import os
import sys
import uuid

RLM_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm")
sys.path.insert(0, RLM_DIR)
from trellis_tools import (  # noqa: E402
    TrellisNeo4j,
    TrellisPostgres,
    get_tool_call_count,
    get_retrieved_addresses,
    get_retrieved_address_count,
    get_citation_audit,
)

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
# The Session 14 layers only (format + existence): sections [1]-[4]
# write BEFORE anything is retrieved, so this client deliberately does
# not wire the Session 31 retrieval-membership seam. The full
# trellis_agent.py research wiring is drilled in section [6].
client = TrellisNeo4j(ast_existence_check=pg.ast_hashes_exist)
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

    # --- Session 30: retrieval-set tracking (PROVENANCE_THREADING.md b) -
    print("\n[5] retrieval-set tracking")

    # Sections [1]-[4] performed Cypher reads, existence checks, and
    # provenance-cited WRITES — none of which are retrieval. The set
    # must still be empty: the cited bucket never feeds it.
    check("cypher reads, existence checks, and cited writes contribute nothing",
          get_retrieved_address_count() == 0,
          f"expected empty set, got {get_retrieved_address_count()} addresses")

    # A Cypher read that surfaces a REAL sourceNodeIds property (the
    # section [4] edge is still live here) puts a genuine 64-hex address
    # in front of the run — a reference to bytes, not the bytes. It must
    # not join the set.
    prov_rows = json.loads(client.run_cypher(
        "MATCH (s:Entity)-[r:DERIVED_INSIGHT]->(o:Entity) "
        "WHERE s.name = 'sandbox probe subject' RETURN r.sourceNodeIds AS ids"
    ))
    check("cypher result really surfaces the probe hash as a provenance property",
          any(PROBE_HASH in (row.get("ids") or []) for row in prov_rows),
          f"probe edge not found in query result: {prov_rows!r}")
    check("a provenance property read via cypher never joins the retrieval set",
          get_retrieved_address_count() == 0)

    # get_ast_texts contributes exactly its RETURNED keys: the unknown
    # hash returns no entry, so it contributes nothing (the argument
    # list is the model's assertion; the returned keys are what the
    # engine served bytes for).
    unknown_read = hashlib.sha256(b"trellis-sandbox-retrieval-unknown").hexdigest()
    json.loads(pg.get_ast_texts([PROBE_HASH, unknown_read]))
    check("get_ast_texts adds exactly the returned keys (unknown hash excluded)",
          get_retrieved_addresses() == {PROBE_HASH},
          f"got {sorted(get_retrieved_addresses())}")

    # Set semantics: repeat retrieval is not new retrieval.
    pg.get_ast_texts([PROBE_HASH])
    check("repeat retrieval leaves the set unchanged",
          get_retrieved_addresses() == {PROBE_HASH})

    # get_ast_blocks contributes the returned BLOCK ids, never the root
    # argument: the run received the blocks' bytes, not the root's
    # reconstruction.
    BLOCKS_ROOT_HASH = hashlib.sha256(b"trellis-sandbox-retrieval-blocks-root").hexdigest()
    BLOCKS_CHILD_HASH = hashlib.sha256(b"trellis-sandbox-retrieval-blocks-child").hexdigest()
    with pg.conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ast_nodes (id, document_id, data) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING",
            (BLOCKS_ROOT_HASH, "sandbox_probe_doc", json.dumps({
                "type": "root",
                "children": [{
                    "id": BLOCKS_CHILD_HASH,
                    "type": "paragraph",
                    "children": [{"type": "text", "content": "retrieval probe paragraph"}],
                }],
            })),
        )
    pg.conn.commit()
    blocks = json.loads(pg.get_ast_blocks(BLOCKS_ROOT_HASH))
    check("get_ast_blocks returns the probe block",
          [b["id"] for b in blocks] == [BLOCKS_CHILD_HASH])
    check("get_ast_blocks adds the returned block ids",
          BLOCKS_CHILD_HASH in get_retrieved_addresses())
    check("the root argument itself never joins the set",
          BLOCKS_ROOT_HASH not in get_retrieved_addresses())

    # vector_search contributes its result ids — drilled zero-paid: a
    # probe row with a deterministic embedding, and the openai module
    # stubbed in sys.modules so the in-function `import openai` binds
    # the stub (no network, no spend). Cosine distance 0 against itself
    # guarantees the probe row is the top hit regardless of what else
    # in the dev store carries embeddings.
    EMBED_HASH = hashlib.sha256(b"trellis-sandbox-retrieval-embed").hexdigest()
    probe_vector = [1.0] + [0.0] * 1535
    with pg.conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ast_nodes (id, document_id, data, embedding) VALUES (%s, %s, %s, %s::vector) "
            "ON CONFLICT (id) DO NOTHING",
            (EMBED_HASH, "sandbox_probe_doc",
             json.dumps({"type": "text", "content": "retrieval embed probe"}),
             json.dumps(probe_vector)),
        )
    pg.conn.commit()

    import types
    stub_openai = types.ModuleType("openai")
    stub_openai.OpenAI = lambda: types.SimpleNamespace(
        embeddings=types.SimpleNamespace(
            create=lambda **kwargs: types.SimpleNamespace(
                data=[types.SimpleNamespace(embedding=list(probe_vector))])))
    real_openai = sys.modules.get("openai")
    sys.modules["openai"] = stub_openai
    try:
        search_rows = json.loads(pg.vector_search("retrieval embed probe"))
    finally:
        if real_openai is not None:
            sys.modules["openai"] = real_openai
        else:
            del sys.modules["openai"]
    check("vector_search returns the embedded probe row first (distance 0)",
          bool(search_rows) and search_rows[0]["id"] == EMBED_HASH,
          f"got {[r['id'][:12] for r in search_rows]}")
    check("vector_search result ids join the retrieval set",
          EMBED_HASH in get_retrieved_addresses())
    check("every returned search id joined the set (bytes travel with addresses)",
          all(row["id"] in get_retrieved_addresses() for row in search_rows))

    # ast_hashes_exist stays outside the set even while tracking is
    # active — including it would open a probe-then-cite loophole.
    count_before_exist = get_retrieved_address_count()
    pg.ast_hashes_exist([PROBE_HASH, EMBED_HASH, unknown_read])
    check("ast_hashes_exist never contributes, even mid-run",
          get_retrieved_address_count() == count_before_exist)

    # The accessor returns a COPY: callers can never mutate run state.
    snapshot = get_retrieved_addresses()
    snapshot.add(unknown_read)
    check("get_retrieved_addresses returns a copy (caller mutation is inert)",
          unknown_read not in get_retrieved_addresses())
    check("count accessor agrees with the set accessor",
          get_retrieved_address_count() == len(get_retrieved_addresses()))

    # Gating separation: the retrieval set is ALWAYS on; the citation
    # audit stays opt-in. With TRELLIS_CITATION_AUDIT/_HINT unset (the
    # drill default), the audit buckets must still be empty while the
    # retrieval set is populated.
    audit = get_citation_audit()
    check("citation audit buckets stay empty while the always-on set is populated",
          audit["read"] == [] and audit["search"] == [] and audit["cited"] == [],
          f"audit unexpectedly populated: {audit}")

    # Static pins (the Session 29 audit-#8 mold): Tier-3 surfaces never
    # touch the tracking seam, and the agent's telemetry dict carries
    # the counts-only field.
    for tier3_module in ("trellis_mcp.py", "trellis_workspace.py", "trellis_textedit.py"):
        with open(os.path.join(RLM_DIR, tier3_module), "r", encoding="utf-8") as fh:
            source = fh.read()
        check(f"{tier3_module} never references the retrieval-tracking seam",
              "_retrieved_addresses" not in source and "_audit_add" not in source)
    with open(os.path.join(RLM_DIR, "trellis_agent.py"), "r", encoding="utf-8") as fh:
        agent_source = fh.read()
    check("agent telemetry carries the counts-only retrieved_addresses field",
          '"retrieved_addresses": get_retrieved_address_count()' in agent_source)

    # --- Session 31: the write-path retrieval-membership gate (slice d) -
    print("\n[6] retrieval-membership write gate")

    # The gated client — constructed exactly the way trellis_agent.py
    # wires it for research runs (existence + retrieval membership;
    # entailment stays None when TRELLIS_CITATION_ENTAIL is unset).
    gated = TrellisNeo4j(
        ast_existence_check=pg.ast_hashes_exist,
        retrieved_addresses_check=get_retrieved_addresses,
    )
    try:
        # Probe rows this section owns: all existent in ast_nodes, none
        # retrieved by any tool call yet (token-scoped via the shared
        # document_id, so the finally-block cleanup catches them).
        UNRETRIEVED_HASH = hashlib.sha256(b"trellis-sandbox-gate-unretrieved").hexdigest()
        GATE_BATCH_HASH = hashlib.sha256(b"trellis-sandbox-gate-batch").hexdigest()
        GATE_BOUND_HASHES = [
            hashlib.sha256(f"trellis-sandbox-gate-bound-{i}".encode()).hexdigest()
            for i in range(7)
        ]
        with pg.conn.cursor() as cur:
            for h in [UNRETRIEVED_HASH, GATE_BATCH_HASH] + GATE_BOUND_HASHES:
                cur.execute(
                    "INSERT INTO ast_nodes (id, document_id, data) VALUES (%s, %s, %s) "
                    "ON CONFLICT (id) DO NOTHING",
                    (h, "sandbox_probe_doc", json.dumps({"type": "text", "content": "gate probe"})),
                )
        pg.conn.commit()

        # An existent-but-unretrieved hash refuses with the full typed
        # message: Provenance Violation + the offending hash + the
        # re-retrieval teaching sentence.
        try:
            gated.write_derived_insight(
                "sandbox gate subject", "mentions", "sandbox gate object", [UNRETRIEVED_HASH])
            check("existent-but-unretrieved hash refuses", False, "nothing raised")
            check("the refusal names the offending hash", False, "nothing raised")
            check("the refusal teaches re-retrieval", False, "nothing raised")
        except ValueError as e:
            msg = str(e)
            check("existent-but-unretrieved hash refuses",
                  "Provenance Violation" in msg and "never retrieved" in msg, msg[:200])
            check("the refusal names the offending hash", UNRETRIEVED_HASH in msg, msg[:200])
            check("the refusal teaches re-retrieval",
                  "get_ast_texts" in msg and "re-derive" in msg, msg[:200])
        except Exception as e:  # noqa: BLE001
            check("existent-but-unretrieved hash refuses", False, f"got {type(e).__name__}: {e}")
            check("the refusal names the offending hash", False, "no ValueError")
            check("the refusal teaches re-retrieval", False, "no ValueError")

        # Fail fast means fail EMPTY: the refused write left no partial
        # state in the graph.
        rows = json.loads(client.run_cypher(
            "MATCH (n:Entity) WHERE n.name = 'sandbox gate subject' RETURN n.name AS name"))
        check("the refused write left no partial state in the graph", rows == [])

        # Bounded echo: >5 unretrieved hashes report first 5 + count.
        try:
            gated.write_derived_insight(
                "sandbox gate subject", "mentions", "sandbox gate object", GATE_BOUND_HASHES)
            check("unretrieved-hash echo is bounded (first 5 + count)", False, "nothing raised")
        except ValueError as e:
            check("unretrieved-hash echo is bounded (first 5 + count)", "+2 more" in str(e),
                  str(e)[:200])

        # Check ORDER is pinned: a hash that is both nonexistent and
        # unretrieved reports the EXISTENCE violation (the Session 14
        # layer runs first), never the retrieval violation.
        unknown_gate = hashlib.sha256(b"trellis-sandbox-gate-unknown").hexdigest()
        try:
            gated.write_derived_insight(
                "sandbox gate subject", "mentions", "sandbox gate object", [unknown_gate])
            check("check order pinned: existence reported before retrieval", False, "nothing raised")
        except ValueError as e:
            check("check order pinned: existence reported before retrieval",
                  "do not exist in ast_nodes" in str(e) and "never retrieved" not in str(e),
                  str(e)[:200])

        # The cited audit bucket records the refused ATTEMPT when the
        # audit is enabled (the A/B eval's measure-the-attempt
        # discipline). The drill runs with the audit env flags unset, so
        # the module gate is flipped directly and restored afterward.
        import trellis_tools as _tt
        _tt._TRACK_CITATIONS = True
        try:
            try:
                gated.write_derived_insight(
                    "sandbox gate subject", "mentions", "sandbox gate object", [UNRETRIEVED_HASH])
            except ValueError:
                pass
            check("the cited bucket records the refused attempt when the audit is enabled",
                  UNRETRIEVED_HASH in get_citation_audit()["cited"])
        finally:
            _tt._TRACK_CITATIONS = False
            with _tt._audit_lock:
                _tt._audit["cited"].clear()
        check("audit state restored after the attempt pin (cited bucket empty again)",
              get_citation_audit()["cited"] == [])

        # The remedy the refusal teaches WORKS: retrieve the hash, then
        # the SAME write succeeds through the same gated client.
        json.loads(pg.get_ast_texts([UNRETRIEVED_HASH]))
        out = json.loads(gated.write_derived_insight(
            "sandbox gate subject", "mentions", "sandbox gate object", [UNRETRIEVED_HASH]))
        check("the SAME write succeeds after get_ast_texts retrieves the hash",
              bool(out) and out[0].get("verb") == "mentions")

        # Batch semantics: one unretrieved hash refuses the ENTIRE batch
        # before any session opens — the retrieved fact is not written
        # either. (PROBE_HASH was retrieved in section [5].)
        try:
            gated.write_derived_insights([
                dict(subject="sandbox gate batch subject", verb="mentions",
                     obj="sandbox gate object", sourceNodeIds=[PROBE_HASH]),
                dict(subject="sandbox gate batch subject", verb="mentions",
                     obj="sandbox gate batch object", sourceNodeIds=[GATE_BATCH_HASH]),
            ])
            check("a batch with one unretrieved hash refuses entirely", False, "nothing raised")
        except ValueError as e:
            check("a batch with one unretrieved hash refuses entirely",
                  "never retrieved" in str(e) and GATE_BATCH_HASH in str(e), str(e)[:200])
        rows = json.loads(client.run_cypher(
            "MATCH (n:Entity) WHERE n.name = 'sandbox gate batch subject' RETURN n.name AS name"))
        check("the refused batch opened no write session (no partial state)", rows == [])

        # The injection-mold pin: a bare-constructed client (no seam
        # wired) writes an existent-but-unretrieved hash exactly as
        # today — the gate activates only through explicit agent wiring.
        bare = TrellisNeo4j(ast_existence_check=pg.ast_hashes_exist)
        try:
            out = json.loads(bare.write_derived_insight(
                "sandbox gate bare subject", "mentions", "sandbox gate object", [GATE_BATCH_HASH]))
            check("bare construction (no seam) writes an unretrieved hash exactly as today",
                  bool(out) and out[0].get("verb") == "mentions")
        finally:
            bare.close()

        # Static pin (the section [5] mold): the agent wires the seam
        # for research runs.
        check("trellis_agent.py wires the retrieval-membership seam",
              "retrieved_addresses_check=get_retrieved_addresses" in agent_source)
    finally:
        gated.close()

    # Cleanup of the probe facts — the test owns a direct write session;
    # this is not the sandbox path.
    with client.driver.session() as s:
        s.run(
            "MATCH (n:Entity) WHERE n.name IN "
            "['sandbox probe subject', 'sandbox probe object', 'sandbox bulk object', "
            "'sandbox gate subject', 'sandbox gate object', 'sandbox gate batch subject', "
            "'sandbox gate batch object', 'sandbox gate bare subject'] "
            "DETACH DELETE n"
        )
finally:
    try:
        with pg.conn.cursor() as cur:
            # All rows this drill owns (the section [5] retrieval probes
            # are token-scoped like the original probe row).
            cur.execute(
                "DELETE FROM ast_nodes WHERE document_id = %s",
                ("sandbox_probe_doc",),
            )
        pg.conn.commit()
    finally:
        pg.close()
        client.close()

if failures:
    print(f"\n{failures} check(s) failed.")
    sys.exit(1)
print("\nAll sandbox checks passed.")
