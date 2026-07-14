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
# gate (PROVENANCE_THREADING.md slice d) on top of it; section [7] pins
# the Session 33 retrieval discipline (RETRIEVAL_DISCIPLINE.md —
# held-state dedup + the per-run budget, active only on
# discipline-enabled construction); section [8] pins the Session 50
# citability probe (RLM_HARNESS_SCAFFOLDING.md §4 — read-only, never a
# gate) and the scaffold injection seams. Probe AST rows are
# token-scoped: inserted by this test, deleted by this test.
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
    get_retrieval_discipline_stats,
    parse_retrieval_budget,
    get_citation_audit,
    RETRIEVAL_BUDGET_DEFAULT,
    RETRIEVAL_BUDGET_MAX,
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
    # in the dev store carries embeddings. Session 40: search_ast_nodes
    # filters to LIVE blocks (members of some document's current
    # version), so the probe registers as its own single-node document —
    # a bare embedded row would be invisible to the tool by design.
    EMBED_HASH = hashlib.sha256(b"trellis-sandbox-retrieval-embed").hexdigest()
    EMBED_DOC_KEY = "sandbox:probe:embed"
    probe_vector = [1.0] + [0.0] * 1535
    with pg.conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ast_nodes (id, document_id, data, embedding) VALUES (%s, %s, %s, %s::vector) "
            "ON CONFLICT (id) DO NOTHING",
            (EMBED_HASH, "sandbox_probe_doc",
             json.dumps({"type": "text", "content": "retrieval embed probe"}),
             json.dumps(probe_vector)),
        )
        cur.execute(
            "INSERT INTO documents (doc_key, version, root_hash) VALUES (%s, 1, %s) "
            "ON CONFLICT (doc_key, version) DO NOTHING",
            (EMBED_DOC_KEY, EMBED_HASH),
        )
        cur.execute(
            "INSERT INTO document_nodes (root_hash, node_id) VALUES (%s, %s) "
            "ON CONFLICT (root_hash, node_id) DO NOTHING",
            (EMBED_HASH, EMBED_HASH),
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

    # --- Session 33: retrieval discipline (RETRIEVAL_DISCIPLINE.md) -----
    print("\n[7] retrieval discipline (held-state dedup + per-run budget)")

    # Sections [1]-[6] used bare construction throughout: an
    # undisciplined instance records nothing, so held state must be
    # empty here — the injection-mold baseline.
    stats0 = get_retrieval_discipline_stats()
    check("bare construction in sections [1]-[6] recorded no held state",
          all(v == 0 for v in stats0.values()), f"{stats0}")

    # The env twin (record §4): kernel default when unset; a set value
    # validated with the same bounds as the TypeScript config.
    check("parse_retrieval_budget defaults to the kernel constant when unset",
          "TRELLIS_RETRIEVAL_BUDGET_PER_RUN" not in os.environ
          and parse_retrieval_budget() == RETRIEVAL_BUDGET_DEFAULT)
    os.environ["TRELLIS_RETRIEVAL_BUDGET_PER_RUN"] = "5"
    check("parse_retrieval_budget honors a valid operator value",
          parse_retrieval_budget() == 5)
    for bad in ("abc", "0", "-3", str(RETRIEVAL_BUDGET_MAX + 1)):
        os.environ["TRELLIS_RETRIEVAL_BUDGET_PER_RUN"] = bad
        try:
            parse_retrieval_budget()
            check(f"parse_retrieval_budget refuses {bad!r}", False, "nothing raised")
        except ValueError:
            check(f"parse_retrieval_budget refuses {bad!r}", True)
    del os.environ["TRELLIS_RETRIEVAL_BUDGET_PER_RUN"]
    try:
        TrellisPostgres(retrieval_discipline=True, retrieval_budget=0)
        check("the constructor refuses an out-of-bounds budget", False, "nothing raised")
    except ValueError:
        check("the constructor refuses an out-of-bounds budget", True)

    # Probe rows this section owns (token-scoped via the shared
    # document_id, like every other probe row in this drill).
    DISC_TEXT_HASHES = [
        hashlib.sha256(f"trellis-sandbox-disc-text-{i}".encode()).hexdigest()
        for i in range(7)
    ]
    DISC_FRESH_HASH = hashlib.sha256(b"trellis-sandbox-disc-fresh").hexdigest()
    DISC_BARE_HASH = hashlib.sha256(b"trellis-sandbox-disc-bare").hexdigest()
    DISC_OVER_HASH = hashlib.sha256(b"trellis-sandbox-disc-over").hexdigest()
    DISC_ROOT_HASH = hashlib.sha256(b"trellis-sandbox-disc-root").hexdigest()
    DISC_CHILD_HASH = hashlib.sha256(b"trellis-sandbox-disc-child").hexdigest()
    with pg.conn.cursor() as cur:
        for h in DISC_TEXT_HASHES + [DISC_FRESH_HASH, DISC_BARE_HASH, DISC_OVER_HASH]:
            cur.execute(
                "INSERT INTO ast_nodes (id, document_id, data) VALUES (%s, %s, %s) "
                "ON CONFLICT (id) DO NOTHING",
                (h, "sandbox_probe_doc", json.dumps({"type": "text", "content": f"disc probe {h[:8]}"})),
            )
        cur.execute(
            "INSERT INTO ast_nodes (id, document_id, data) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING",
            (DISC_ROOT_HASH, "sandbox_probe_doc", json.dumps({
                "type": "root",
                "children": [{
                    "id": DISC_CHILD_HASH,
                    "type": "paragraph",
                    "children": [{"type": "text", "content": "disc probe paragraph"}],
                }],
            })),
        )
    pg.conn.commit()

    disc = TrellisPostgres(retrieval_discipline=True, retrieval_budget=64)
    try:
        # First fetch of every surface: byte-identical to a bare fetch
        # of the same request (record §5 — the discipline never changes
        # what a fresh fetch returns).
        bare_one = pg.get_ast_texts([DISC_TEXT_HASHES[0]])
        disc_one = disc.get_ast_texts([DISC_TEXT_HASHES[0]])
        check("first disciplined get_ast_texts is byte-identical to a bare fetch",
              disc_one == bare_one)

        # A full repeat refuses: typed, names the held hashes, teaches
        # binding reuse.
        try:
            disc.get_ast_texts([DISC_TEXT_HASHES[0]])
            check("a full-repeat get_ast_texts refuses", False, "nothing raised")
            check("the dedup refusal teaches binding reuse", False, "nothing raised")
        except ValueError as e:
            msg = str(e)
            check("a full-repeat get_ast_texts refuses",
                  "Retrieval Discipline" in msg and DISC_TEXT_HASHES[0] in msg, msg[:200])
            check("the dedup refusal teaches binding reuse",
                  "Reuse the variable" in msg and "re-derive" in msg, msg[:200])

        # Partial overlap serves EVERYTHING (record §2.2): held keys are
        # never silently dropped, and the bytes match a bare fetch.
        pair = [DISC_TEXT_HASHES[0], DISC_TEXT_HASHES[1]]
        bare_pair = pg.get_ast_texts(pair)
        disc_pair = disc.get_ast_texts(pair)
        check("partial overlap serves everything, byte-identical to a bare fetch",
              disc_pair == bare_pair)
        served = json.loads(disc_pair)
        check("the held hash is served again in the overlap call (never dropped)",
              DISC_TEXT_HASHES[0] in served and DISC_TEXT_HASHES[1] in served)

        # Bounded echo: with all 7 hashes held, the repeat names the
        # first 5 + a count.
        disc.get_ast_texts(DISC_TEXT_HASHES[2:])
        try:
            disc.get_ast_texts(DISC_TEXT_HASHES)
            check("the dedup echo is bounded (first 5 + count)", False, "nothing raised")
        except ValueError as e:
            check("the dedup echo is bounded (first 5 + count)", "+2 more" in str(e),
                  str(e)[:200])

        # The recorded evasion, pinned honestly (record §2.2): padding a
        # repeat with a never-held hash passes — full-repeat only.
        evade = json.loads(disc.get_ast_texts([DISC_TEXT_HASHES[0], DISC_FRESH_HASH]))
        check("a repeat padded with a fresh hash serves (dedup is full-repeat only)",
              DISC_FRESH_HASH in evade)

        # get_ast_blocks: per-root identity (record §2.3).
        bare_blocks = pg.get_ast_blocks(DISC_ROOT_HASH)
        disc_blocks = disc.get_ast_blocks(DISC_ROOT_HASH)
        check("first disciplined get_ast_blocks is byte-identical to a bare fetch",
              disc_blocks == bare_blocks)
        try:
            disc.get_ast_blocks(DISC_ROOT_HASH)
            check("a repeat get_ast_blocks on a held root refuses", False, "nothing raised")
        except ValueError as e:
            check("a repeat get_ast_blocks on a held root refuses",
                  "Retrieval Discipline" in str(e) and DISC_ROOT_HASH in str(e), str(e)[:200])
        # The served block ids joined held addresses: reading exactly
        # them via get_ast_texts is a repeat by the §2.2 rule…
        try:
            disc.get_ast_texts([DISC_CHILD_HASH])
            check("get_ast_texts on exactly the served block ids is a repeat", False,
                  "nothing raised")
        except ValueError as e:
            check("get_ast_texts on exactly the served block ids is a repeat",
                  "Retrieval Discipline" in str(e), str(e)[:200])
        # …but the root argument itself never joined: its own
        # reconstruction bytes were not returned (the Session 30 shape).
        root_text = json.loads(disc.get_ast_texts([DISC_ROOT_HASH]))
        check("get_ast_texts([root]) after get_ast_blocks(root) serves",
              root_text.get(DISC_ROOT_HASH, "") != "")

        # vector_search: exact-query-match only (record §2.4), drilled
        # zero-paid with the section [5] stub and embedded probe row.
        sys.modules["openai"] = stub_openai
        try:
            bare_search = pg.vector_search("disc dedup probe")
            disc_search = disc.vector_search("disc dedup probe")
            check("first disciplined vector_search is byte-identical to a bare search",
                  disc_search == bare_search)
            try:
                disc.vector_search("disc dedup probe")
                check("an exact-repeat query refuses", False, "nothing raised")
            except ValueError as e:
                check("an exact-repeat query refuses",
                      "Retrieval Discipline" in str(e) and "exact query" in str(e),
                      str(e)[:200])
            rephrased = json.loads(disc.vector_search("disc dedup probe, rephrased"))
            check("a different query string serves (semantic dedup excluded by decision)",
                  bool(rephrased))
            # Search result ids never join held addresses: reading a hit
            # afterward is the confirm-before-cite pattern the Session 31
            # write gate teaches — it must keep working.
            hit_id = json.loads(disc_search)[0]["id"]
            hit_text = json.loads(disc.get_ast_texts([hit_id]))
            check("reading a search hit via get_ast_texts serves (the taught pattern)",
                  hit_id in hit_text)
        finally:
            if real_openai is not None:
                sys.modules["openai"] = real_openai
            else:
                del sys.modules["openai"]

        # The budget (record §4): budget N serves N byte-returning
        # fetches; call N+1 refuses with counts + a bounded held-root
        # echo, before any I/O.
        stats_now = get_retrieval_discipline_stats()
        tight = TrellisPostgres(retrieval_discipline=True,
                                retrieval_budget=stats_now["retrieval_fetches"] + 1)
        try:
            in_budget = json.loads(tight.get_ast_texts([DISC_BARE_HASH]))
            check("the budgeted instance serves its final in-budget fetch",
                  DISC_BARE_HASH in in_budget)
            try:
                tight.get_ast_texts([DISC_OVER_HASH])
                check("the budget refusal fires at budget+1", False, "nothing raised")
                check("the budget refusal carries counts and a bounded held-root echo",
                      False, "nothing raised")
            except ValueError as e:
                msg = str(e)
                check("the budget refusal fires at budget+1",
                      "Retrieval Discipline" in msg and "budget" in msg, msg[:200])
                check("the budget refusal carries counts and a bounded held-root echo",
                      "addresses" in msg and "block roots" in msg and DISC_ROOT_HASH in msg,
                      msg[:200])
            # Check order pinned: a REPEAT on the exhausted instance gets
            # the dedup refusal (the actionable teaching), and refusals
            # of either kind consume no budget.
            before = get_retrieval_discipline_stats()
            try:
                tight.get_ast_texts([DISC_TEXT_HASHES[0]])
                check("a repeat on an exhausted instance still gets the DEDUP refusal",
                      False, "nothing raised")
            except ValueError as e:
                check("a repeat on an exhausted instance still gets the DEDUP refusal",
                      "already retrieved" in str(e) and "budget" not in str(e),
                      str(e)[:200])
            after = get_retrieval_discipline_stats()
            check("dedup refusals consume no budget",
                  after["retrieval_fetches"] == before["retrieval_fetches"])
            check("both refusal counters counted their attempts",
                  after["retrieval_dedup_refusals"] == before["retrieval_dedup_refusals"] + 1
                  and after["retrieval_budget_refusals"] >= 1)
        finally:
            tight.close()

        # Guardrail 4 re-proven under the new machinery: held state is
        # bookkeeping over retrieval, never over citability.
        rset_before = get_retrieved_address_count()
        try:
            disc.get_ast_texts([DISC_TEXT_HASHES[0]])
        except ValueError:
            pass
        check("a dedup refusal leaves the retrieval set unchanged",
              get_retrieved_address_count() == rset_before)
        check("disciplined serves still feed the always-on retrieval set",
              DISC_FRESH_HASH in get_retrieved_addresses())
        gated_disc = TrellisNeo4j(
            ast_existence_check=pg.ast_hashes_exist,
            retrieved_addresses_check=get_retrieved_addresses,
        )
        try:
            out = json.loads(gated_disc.write_derived_insight(
                "sandbox disc subject", "mentions", "sandbox disc object",
                [DISC_TEXT_HASHES[0]]))
            check("held state never gates citability: a dedup-refused hash still writes",
                  bool(out) and out[0].get("verb") == "mentions")
        finally:
            gated_disc.close()

        # The injection-mold pin: bare construction keeps serving repeat
        # fetches byte-for-byte and records nothing.
        held_before = get_retrieval_discipline_stats()
        bare_repeat = json.loads(pg.get_ast_texts([DISC_TEXT_HASHES[0]]))
        check("bare construction still serves repeat fetches (injection mold)",
              DISC_TEXT_HASHES[0] in bare_repeat)
        check("bare fetches record no held state",
              get_retrieval_discipline_stats() == held_before)

        # A refused call still counts as a database tool invocation (the
        # write-path refusal precedent — the count is a floor, never a
        # reward).
        tc_before = get_tool_call_count()
        try:
            disc.get_ast_texts([DISC_TEXT_HASHES[0]])
        except ValueError:
            pass
        check("a refused call still counts as a database tool invocation",
              get_tool_call_count() == tc_before + 1)

        # The stats accessor returns a fresh snapshot, never live state.
        snap = get_retrieval_discipline_stats()
        snap["retrieval_fetches"] = -999
        check("get_retrieval_discipline_stats returns a copy (caller mutation is inert)",
              get_retrieval_discipline_stats()["retrieval_fetches"] != -999)

        # Static pins (the section [5]/[6] mold): the agent wires the
        # discipline for research runs with the OFF-arm escape, the
        # telemetry carries counts only, and Tier-3 surfaces never touch
        # the held-state seam (so no parked/seeded state can carry it —
        # a seeded run inherits NO held state).
        check("trellis_agent.py wires the discipline for research runs",
              "retrieval_discipline=not EXP_OMIT_RETRIEVAL_ENABLED" in agent_source
              and "retrieval_budget=parse_retrieval_budget()" in agent_source)
        check("agent telemetry carries the counts-only discipline stats",
              "get_retrieval_discipline_stats()" in agent_source)
        check("the OFF-arm flag is read only at the agent",
              'os.getenv("TRELLIS_EXP_OMIT_RETRIEVAL") == "1"' in agent_source)
        for tier3_module in ("trellis_mcp.py", "trellis_workspace.py", "trellis_textedit.py"):
            with open(os.path.join(RLM_DIR, tier3_module), "r", encoding="utf-8") as fh:
                source = fh.read()
            check(f"{tier3_module} never references the held-state seam",
                  "_held" not in source and "retrieval_discipline" not in source)
    finally:
        disc.close()

    # --- Session 50: the citability probe (RLM_HARNESS_SCAFFOLDING.md) --
    print("\n[8] citability probe (read-only; never a gate) + scaffold seams")

    from trellis_scaffold import build_scaffold_helpers

    # A live-but-unretrieved probe: its own single-node document gives
    # it current-version membership (the Session 40 liveness shape),
    # and no tool has fetched its bytes.
    CIT_LIVE_HASH = hashlib.sha256(b"trellis-sandbox-citable-live").hexdigest()
    CIT_DOC_KEY = "sandbox:probe:citable"
    with pg.conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ast_nodes (id, document_id, data) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING",
            (CIT_LIVE_HASH, "sandbox_probe_doc",
             json.dumps({"type": "text", "content": "citable probe block"})),
        )
        cur.execute(
            "INSERT INTO documents (doc_key, version, root_hash) VALUES (%s, 1, %s) "
            "ON CONFLICT (doc_key, version) DO NOTHING",
            (CIT_DOC_KEY, CIT_LIVE_HASH),
        )
        cur.execute(
            "INSERT INTO document_nodes (root_hash, node_id) VALUES (%s, %s) "
            "ON CONFLICT (root_hash, node_id) DO NOTHING",
            (CIT_LIVE_HASH, CIT_LIVE_HASH),
        )
    pg.conn.commit()

    check("bare scaffold construction injects nothing (injection mold)",
          build_scaffold_helpers() == {})
    scaffold = build_scaffold_helpers(
        postgres=pg,
        retrieved_addresses_fn=get_retrieved_addresses,
        named_files=["embed", "citable"],
        doc_key_prefix="sandbox:probe:",
    )
    check("named files + database surfaces inject exactly the citable probe",
          sorted(scaffold) == ["citable"])
    citable = scaffold["citable"]

    # By this point in the drill: EMBED_HASH was retrieved (its bytes
    # rode a vector_search result) and is live under a named doc;
    # PROBE_HASH was retrieved but has NO current-version membership;
    # CIT_LIVE_HASH is live under a named doc but never retrieved;
    # `unknown` is well-formed and absent from ast_nodes.
    tc_before_cit = get_tool_call_count()
    rs_before_cit = get_retrieved_address_count()
    report = citable([EMBED_HASH, PROBE_HASH, CIT_LIVE_HASH, unknown])
    check("retrieved + live-under-a-named-doc reports citable",
          report[EMBED_HASH]["citable"] is True
          and report[EMBED_HASH]["retrieved"] is True
          and report[EMBED_HASH]["live_doc_keys"] == [EMBED_DOC_KEY]
          and report[EMBED_HASH]["bridges_named_file"] is True,
          json.dumps(report[EMBED_HASH]))
    check("retrieved-but-membership-less reports NOT citable (dead class)",
          report[PROBE_HASH]["citable"] is False
          and report[PROBE_HASH]["retrieved"] is True
          and report[PROBE_HASH]["exists"] is True
          and report[PROBE_HASH]["live_doc_keys"] == [],
          json.dumps(report[PROBE_HASH]))
    check("live-but-unretrieved reports NOT citable (retrieval is the missing half)",
          report[CIT_LIVE_HASH]["citable"] is False
          and report[CIT_LIVE_HASH]["retrieved"] is False
          and report[CIT_LIVE_HASH]["bridges_named_file"] is True,
          json.dumps(report[CIT_LIVE_HASH]))
    check("a ghost hash reports absent on every axis",
          report[unknown]["exists"] is False
          and report[unknown]["retrieved"] is False
          and report[unknown]["live_doc_keys"] == []
          and report[unknown]["citable"] is False,
          json.dumps(report[unknown]))

    # The probe is bookkeeping-inert: no tool-call count, no retrieval
    # set growth, no audit bucket — reading it earns nothing.
    check("citable never increments the database tool-call count",
          get_tool_call_count() == tc_before_cit)
    check("citable never feeds the retrieval set",
          get_retrieved_address_count() == rs_before_cit)
    audit_after_cit = get_citation_audit()
    check("citable never touches the citation audit buckets",
          audit_after_cit["read"] == [] and audit_after_cit["cited"] == [])

    # The taught remedy works through the probe too: retrieve the live
    # hash, and the SAME probe call flips to citable.
    json.loads(pg.get_ast_texts([CIT_LIVE_HASH]))
    report2 = citable([CIT_LIVE_HASH])
    check("after get_ast_texts the same hash reports citable",
          report2[CIT_LIVE_HASH]["citable"] is True)

    # NEVER A GATE: an unretrieved-but-live hash still refuses at the
    # Session 31 write gate even though the probe can describe it —
    # the probe informs; the gate decides (drilled here so the two are
    # observed together, never conflated).
    gated_cit = TrellisNeo4j(
        ast_existence_check=pg.ast_hashes_exist,
        retrieved_addresses_check=get_retrieved_addresses,
    )
    try:
        probe_only = citable([GATE_BOUND_HASHES[0]])
        check("the probe describes an uncitable hash without writing anything",
              probe_only[GATE_BOUND_HASHES[0]]["citable"] is False)
        try:
            gated_cit.write_derived_insight(
                "sandbox citable subject", "mentions", "sandbox citable object",
                [GATE_BOUND_HASHES[0]])
            check("the write gate still refuses regardless of the probe", False,
                  "nothing raised")
        except ValueError as e:
            check("the write gate still refuses regardless of the probe",
                  "never retrieved" in str(e), str(e)[:200])
    finally:
        gated_cit.close()

    # Validation refusals: typed, before any round trip.
    for bad, needle in ((None, "LIST"), ([], "LIST"), (["x", 5], "LIST")):
        try:
            citable(bad)
            check(f"citable refuses {bad!r}", False, "nothing raised")
        except ValueError as e:
            check(f"citable refuses {bad!r}", needle in str(e), str(e)[:120])
    try:
        citable([hashlib.sha256(f"over-{i}".encode()).hexdigest() for i in range(65)])
        check("citable refuses an over-cap batch", False, "nothing raised")
    except ValueError as e:
        check("citable refuses an over-cap batch", "at most" in str(e), str(e)[:120])

    # Static pins (the section [5]/[6]/[7] mold): the agent wires the
    # scaffolds at the recorded seams, and the scaffold module never
    # touches the tracking internals (it reads only through the
    # injected accessor).
    check("trellis_agent.py injects the task surface",
          '"trellis_task": task_surface' in agent_source)
    check("trellis_agent.py wraps the task at the system-prompt splice",
          "wrap_task_text(safe_query, run_uuid)" in agent_source)
    check("trellis_agent.py wraps the task at the completion query",
          "wrap_task_text(args.query, run_uuid)" in agent_source)
    check("trellis_agent.py validates the named-files input before paid work",
          "task_named_files = parse_task_named_files()" in agent_source)
    check("trellis_agent.py injects the helpers through the scaffold factory",
          "build_scaffold_helpers(" in agent_source
          and "named_files=task_named_files" in agent_source)
    check("trellis_agent.py composes both conditional scaffold addenda",
          "build_helpers_addendum(scaffold_helpers)" in agent_source
          and "build_citable_addendum(scaffold_helpers)" in agent_source)
    with open(os.path.join(RLM_DIR, "trellis_scaffold.py"), "r", encoding="utf-8") as fh:
        scaffold_source = fh.read()
    check("trellis_scaffold.py never touches the retrieval-tracking seam",
          "_retrieved_addresses" not in scaffold_source
          and "_audit_add" not in scaffold_source
          and "_held" not in scaffold_source
          and "_count_tool_call" not in scaffold_source)

    # Cleanup of the probe facts — the test owns a direct write session;
    # this is not the sandbox path.
    with client.driver.session() as s:
        s.run(
            "MATCH (n:Entity) WHERE n.name IN "
            "['sandbox probe subject', 'sandbox probe object', 'sandbox bulk object', "
            "'sandbox gate subject', 'sandbox gate object', 'sandbox gate batch subject', "
            "'sandbox gate batch object', 'sandbox gate bare subject', "
            "'sandbox disc subject', 'sandbox disc object'] "
            "DETACH DELETE n"
        )
finally:
    try:
        with pg.conn.cursor() as cur:
            # All rows this drill owns (the section [5] retrieval probes
            # are token-scoped like the original probe row). The embed
            # probe's membership rows (Session 40 liveness) go first so
            # their foreign keys never block the ast_nodes delete.
            cur.execute(
                "DELETE FROM document_nodes WHERE root_hash IN "
                "(SELECT root_hash FROM documents WHERE doc_key IN (%s, %s))",
                ("sandbox:probe:embed", "sandbox:probe:citable"),
            )
            cur.execute(
                "DELETE FROM documents WHERE doc_key IN (%s, %s)",
                ("sandbox:probe:embed", "sandbox:probe:citable"),
            )
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
