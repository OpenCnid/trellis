import os
import json
import re
import threading
from neo4j import GraphDatabase, READ_ACCESS, WRITE_ACCESS
import psycopg2

# Session 24: the AST block walk lives in the dependency-free
# trellis_blocks module so the TypeScript parity test can spawn it
# without the database runtime installed. `node_text` is re-exported
# under its historical private name — the reconstruction semantics are
# byte-identical (test:rlm-workspace [0] still pins them through this
# import).
from trellis_blocks import blocks_from_root, node_text as _node_text

# One call site, one commitment: each surface below binds its descriptor
# at its own definition site (SELF_DESCRIBING_SURFACES.md §12, increment
# 2a). trellis_surfaces imports only ast and os, so this adds no runtime
# dependency to a module the drills import without a database.
from trellis_surfaces import register_surface

# Session 14 (design record §10.2): an AST hash is 64 lowercase hex chars
# (SHA-256 via digest('hex')). Tier-3 identifiers (uuids, module names)
# are structurally disjoint from this shape, so nothing scratch-shaped
# can ever be written as provenance.
AST_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")

# --- TREC rubric: single source of truth -------------------------------
# The rubric prompt is versioned text shared between the RLM agent (which
# embeds it in classification prompts) and the Phase 5 verifier (which
# re-checks cached beliefs against the same text). Every derived-insight
# write is stamped with the version it was written under; a version bump
# routes older edges into the verifier's mandatory re-check tier.
_RUBRIC_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "trec_rubric.json")
with open(_RUBRIC_PATH, "r", encoding="utf-8") as _rubric_file:
    _RUBRIC = json.load(_rubric_file)
RUBRIC_VERSION = _RUBRIC["version"]
RUBRIC_TEXT = _RUBRIC["rubric"]

# Counts every database tool invocation made from the REPL. An RLM answer
# produced with zero tool calls has no provenance and is treated as a
# protocol violation by the benchmark runner.
_tool_call_lock = threading.Lock()
_tool_call_stats = {"count": 0}

def _count_tool_call():
    with _tool_call_lock:
        _tool_call_stats["count"] += 1

def get_tool_call_count() -> int:
    return _tool_call_stats["count"]

# --- Citation audit (opt-in measurement, off by default) ---------------
# For the provenance-citation A/B eval: when TRELLIS_CITATION_AUDIT=1,
# record which AST hashes the run actually READ (get_ast_texts returns),
# which it SAW in vector_search results, and which it CITED as
# sourceNodeIds. A cited hash the run never read cannot have been derived
# from those bytes — the deterministic laundering signal. Purely
# observational: it changes no tool return value and no prompt, and it
# emits nothing unless enabled, so a normal run stays byte-identical and
# the T16 no-hashes-in-logs rule holds (hashes appear only on the opt-in
# TRELLIS_CITATION_AUDIT line the eval probe consumes).
CITATION_AUDIT_ENABLED = os.getenv("TRELLIS_CITATION_AUDIT") == "1"
# The HYBRID arm of the A/B eval: a STRUCTURAL read-before-cite soft-gate.
# When TRELLIS_CITATION_HINT=1, the write path refuses to cite a hash the
# run never read via get_ast_texts, with a self-correcting message — the
# discipline enforced by the harness rather than requested by a prompt.
# Off by default (byte-identical); experimental, not a shipped gate.
CITATION_HINT_ENABLED = os.getenv("TRELLIS_CITATION_HINT") == "1"
_TRACK_CITATIONS = CITATION_AUDIT_ENABLED or CITATION_HINT_ENABLED
_audit_lock = threading.Lock()
_audit = {"read": set(), "search": set(), "cited": set()}

# --- Retrieval-set tracking (Session 30, always on) ---------------------
# PROVENANCE_THREADING.md slice (b): the run's retrieved-address set —
# every ast_nodes id whose BYTES a retrieval tool returned this run
# (get_ast_texts returned keys, get_ast_blocks block ids, vector_search
# result ids). Fed at the same seam as the citation audit's read/search
# buckets; the cited bucket never feeds it (a citation is an assertion,
# not a retrieval), and neither do ast_hashes_exist (write-path plumbing
# — including it would open a probe-then-cite loophole), fetch_texts
# (harness plumbing), or run_cypher (a sourceNodeIds property in a query
# result is a reference to bytes, not the bytes). Unlike the audit this
# is NOT experiment-gated: slice (d) will constrain citable addresses to
# this set on research runs: the write gate _verify_hashes_retrieved
# consumes this set through the retrieved_addresses_check seam; bare construction is unaffected. Telemetry reports its size, never its contents (T16).
_retrieved_addresses = set()

def _audit_add(bucket, ids):
    clean = {i for i in ids if isinstance(i, str)}
    if bucket in ("read", "search"):
        with _audit_lock:
            _retrieved_addresses.update(clean)
    if not _TRACK_CITATIONS:
        return
    with _audit_lock:
        _audit[bucket].update(clean)

def get_retrieved_addresses() -> set:
    """A COPY of the run's retrieved-address set (callers can never
    mutate run state). Slice (d) is live on research runs: the write gate _verify_hashes_retrieved consumes this set through the retrieved_addresses_check seam; bare construction is unaffected."""
    with _audit_lock:
        return set(_retrieved_addresses)

def get_retrieved_address_count() -> int:
    with _audit_lock:
        return len(_retrieved_addresses)

def _read_set() -> set:
    with _audit_lock:
        return set(_audit["read"])

def get_citation_audit() -> dict:
    """Sorted read/search/cited hash sets plus the derived laundering
    signals. Empty when the audit is disabled."""
    with _audit_lock:
        read = set(_audit["read"])
        search = set(_audit["search"])
        cited = set(_audit["cited"])
    return {
        "read": sorted(read),
        "search": sorted(search),
        "cited": sorted(cited),
        # Cited but never read via get_ast_texts — the core laundering
        # signal (a claim cannot derive from bytes the run never fetched).
        "citedButUnread": sorted(cited - read),
        # Cited AND surfaced by vector_search — module #1's exact
        # signature (citing a semantically-adjacent search hit).
        "citedFromSearch": sorted(cited & search),
    }


# --- Retrieval discipline (Session 33, RETRIEVAL_DISCIPLINE.md) --------
# Held-state dedup + the per-run retrieval budget at the three Tier-1
# retrieval surfaces. Held state answers "were these bytes already
# served to this run" — bookkeeping over retrieval, NEVER over
# citability: it is a different structure from the Session 30 retrieval
# set (which answers "which addresses may this run cite"), under its
# own lock, and the two never feed each other. Held state holds
# IDENTITIES only (hashes, roots, query strings), never content —
# serving from held state would require a store mirror the pillar
# forbids, so a repeat fetch REFUSES with a typed teaching message.
# Recording and checking both happen only on discipline-enabled
# TrellisPostgres instances (explicit construction at the agent, the
# retrieved_addresses_check injection mold); bare construction is
# byte-identical to before this machinery existed. Per run = per
# process: the state dies with the process and is never parked or
# seeded. Telemetry reports counts only (T16).
RETRIEVAL_BUDGET_DEFAULT = 64
RETRIEVAL_BUDGET_MAX = 1024

_held_lock = threading.Lock()
_held = {
    # Hashes whose bytes a disciplined get_ast_texts/get_ast_blocks
    # call served. vector_search result ids deliberately do NOT join:
    # reading a search hit via get_ast_texts is the confirm-before-cite
    # pattern the Session 31 write-gate refusal explicitly teaches.
    "addresses": set(),
    # get_ast_blocks roots already served (the measured repeat class).
    "roots": set(),
    # Exact vector_search query strings already served. Semantic
    # near-duplicate detection is excluded by decision (record §2.4):
    # "same question, different words" is a semantic judgment, not
    # plumbing.
    "queries": set(),
    "fetches": 0,
    "dedup_refusals": 0,
    "budget_refusals": 0,
}


def parse_retrieval_budget() -> int:
    """Python twin of the TRELLIS_RETRIEVAL_BUDGET_PER_RUN config bound
    (record §4): unset means the kernel default; a set value must be a
    positive integer no greater than RETRIEVAL_BUDGET_MAX. Invalid
    values raise here, before any paid work."""
    raw = os.getenv("TRELLIS_RETRIEVAL_BUDGET_PER_RUN")
    if raw is None or not raw.strip():
        return RETRIEVAL_BUDGET_DEFAULT
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(
            f"Invalid TRELLIS_RETRIEVAL_BUDGET_PER_RUN: {raw!r} is not an integer."
        )
    if value < 1 or value > RETRIEVAL_BUDGET_MAX:
        raise ValueError(
            f"Invalid TRELLIS_RETRIEVAL_BUDGET_PER_RUN: {value} is outside "
            f"[1, {RETRIEVAL_BUDGET_MAX}]."
        )
    return value


def get_retrieval_discipline_stats() -> dict:
    """Counts-only snapshot of the run's retrieval-discipline state for
    TRELLIS_TELEMETRY (identities never leave the module — T16)."""
    with _held_lock:
        return {
            "retrieval_fetches": _held["fetches"],
            "retrieval_dedup_refusals": _held["dedup_refusals"],
            "retrieval_budget_refusals": _held["budget_refusals"],
            "held_addresses": len(_held["addresses"]),
            "held_roots": len(_held["roots"]),
            "held_queries": len(_held["queries"]),
        }


def _bounded_echo(items, limit=5):
    """First `limit` items + a count of the rest — the write-gate echo
    discipline, shared by the dedup and budget refusals."""
    shown = ", ".join(items[:limit])
    more = f" (+{len(items) - limit} more)" if len(items) > limit else ""
    return shown + more


# The semantic (entailment) citation gate — the experimental §7 v3 tier
# (GROUNDED_AUTHORING). Off by default; when TRELLIS_CITATION_ENTAIL=1 the
# write path calls an injected checker that asks, per cited block, whether
# the block's text supports the claim, and refuses unsupported citations.
# Structural checks (existence, readership) cannot catch laundering — the
# measured finding in PROVENANCE_CITATION_AB_REPORT.md — because support is
# semantic. Byte-identical when off.
CITATION_ENTAIL_ENABLED = os.getenv("TRELLIS_CITATION_ENTAIL") == "1"


class TrellisNeo4j:
    def __init__(self, ast_existence_check=None, entailment_check=None,
                 retrieved_addresses_check=None):
        # Retrieve config from environment variables
        uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
        user = os.getenv("NEO4J_USER", "neo4j")
        password = os.getenv("NEO4J_PASSWORD", "trellis_password")
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        # Session 14 hardening: a callable taking a list of hashes and
        # returning a JSON list of the MISSING ones (the shape of
        # TrellisPostgres.ast_hashes_exist). When wired, every insight
        # write verifies its cited hashes exist in ast_nodes BEFORE the
        # WRITE session opens — "an AST hash means verified ingested
        # bytes" becomes enforcement, not convention.
        self._ast_existence_check = ast_existence_check
        # Experimental semantic citation gate (off unless
        # TRELLIS_CITATION_ENTAIL=1): a callable
        # (subject, verb, obj, hashes) -> list of hashes whose block text
        # does NOT support the claim. When wired, unsupported citations
        # are refused before the write.
        self._entailment_check = entailment_check
        # Session 31 (PROVENANCE_THREADING.md slice d): a callable
        # returning the run's current retrieved-address set (the
        # slice (b) tracking's get_retrieved_addresses). When wired,
        # every insight write additionally requires that each cited
        # hash is IN the run's retrieval set — the T1 closure. None
        # (the default) keeps bare construction byte-identical:
        # operator scripts and drills write exactly as before. Wired
        # only by explicit construction at the agent, the
        # ast_existence_check injection mold.
        self._retrieved_addresses_check = retrieved_addresses_check

    def run_cypher(self, query: str) -> str:
        """
        Executes a read-only Cypher query against the Trellis Knowledge Graph.
        """
        _count_tool_call()
        # Fast-fail courtesy check (T7): catches the obvious mutations with
        # a readable error before a round trip. NOT the security boundary —
        # keyword-evading writes (e.g. procedure calls) slip past a regex.
        forbidden_keywords = ["CREATE", "MERGE", "DELETE", "SET", "DROP", "REMOVE", "DETACH"]
        upper_query = query.upper()
        for keyword in forbidden_keywords:
            import re
            if re.search(r'\b' + keyword + r'\b', upper_query):
                raise ValueError(f"Security Violation: Mutation keyword '{keyword}' blocked. Use write_derived_insight for writing.")

        # Database errors must RAISE so the REPL surfaces a real Python
        # traceback that the RLM loop intercepts and feeds back to the
        # agent for self-correction (Evaluation-as-a-Loop).
        #
        # The authoritative read-only enforcement is transport-level (T7):
        # default_access_mode=READ makes the server itself reject any write
        # in this session, including write *procedures* whose names contain
        # no blocked keyword (verified live by scripts/test_rlm_sandbox.py).
        try:
            with self.driver.session(default_access_mode=READ_ACCESS) as session:
                result = session.run(query)
                records = [record.data() for record in result]
                return json.dumps(records)
        except Exception as e:
            raise RuntimeError(f"Neo4jError while executing Cypher: {e}") from e

    # Entity kinds (Phase 5 Milestone 2): every flywheel-written node
    # carries a `kind` so the verifier can find classification beliefs
    # structurally instead of by regex-matching names. The writer knows
    # what it is writing — has_category implies question -> category_label,
    # mentions implies question -> concept — so kinds are inferred from
    # the verb unless the caller supplies subject_kind / object_kind
    # explicitly. A specific kind is never downgraded back to 'generic'.
    ENTITY_KINDS = ("question", "category_label", "concept", "generic")
    _KIND_INFERENCE = {
        "has_category": ("question", "category_label"),
        "mentions": ("question", "concept"),
    }

    # Architecture Invariant 4 (Flywheel Exception): derived facts are
    # written as whitelisted [DERIVED_INSIGHT] edges carrying spatial
    # provenance. This is the ONLY mutation path in the sandbox — both the
    # single and bulk write methods funnel through this one UNWIND query.
    #
    # Node updates mirror the edge's un-contest-on-rederive semantics
    # (closing the Phase 4 asymmetry where re-derivation un-contested the
    # edge but left its endpoint nodes quarantined): orphaned hashes are
    # dropped from node provenance and contested clears on re-derivation.
    # An incoming hash that was previously orphaned
    # is resurrected (document revert): it moves back to sourceNodeIds,
    # matching extraction_merge.ts. Other orphan history remains.
    _WRITE_INSIGHT_QUERY = """
    UNWIND $facts AS f
    MERGE (s:Entity {name: toLower(f.subject)})
    MERGE (o:Entity {name: toLower(f.obj)})
    MERGE (s)-[r:DERIVED_INSIGHT {verb: toLower(f.verb)}]->(o)
    SET s.kind = CASE
            WHEN f.subject_kind IS NULL THEN s.kind
            WHEN f.subject_kind = 'generic' AND NOT coalesce(s.kind, 'generic') = 'generic' THEN s.kind
            ELSE f.subject_kind END,
        o.kind = CASE
            WHEN f.object_kind IS NULL THEN o.kind
            WHEN f.object_kind = 'generic' AND NOT coalesce(o.kind, 'generic') = 'generic' THEN o.kind
            ELSE f.object_kind END,
        s.rederivedAt = CASE WHEN coalesce(s.contested, false) THEN timestamp() ELSE s.rederivedAt END,
        o.rederivedAt = CASE WHEN coalesce(o.contested, false) THEN timestamp() ELSE o.rederivedAt END,
        s.sourceNodeIds = [x IN coalesce(s.sourceNodeIds, [])
                           WHERE NOT x IN f.sourceNodeIds
                             AND NOT x IN coalesce(s.orphanedSourceIds, [])] + f.sourceNodeIds,
        s.orphanedSourceIds = CASE WHEN s.orphanedSourceIds IS NULL THEN NULL
                                   ELSE [x IN s.orphanedSourceIds WHERE NOT x IN f.sourceNodeIds] END,
        o.sourceNodeIds = [x IN coalesce(o.sourceNodeIds, [])
                           WHERE NOT x IN f.sourceNodeIds
                             AND NOT x IN coalesce(o.orphanedSourceIds, [])] + f.sourceNodeIds,
        o.orphanedSourceIds = CASE WHEN o.orphanedSourceIds IS NULL THEN NULL
                                   ELSE [x IN o.orphanedSourceIds WHERE NOT x IN f.sourceNodeIds] END,
        s.contested = false,
        o.contested = false,
        r.rederivedAt = CASE WHEN coalesce(r.contested, false) THEN timestamp() ELSE r.rederivedAt END,
        r.sourceNodeIds = [x IN coalesce(r.sourceNodeIds, [])
                           WHERE NOT x IN f.sourceNodeIds
                             AND NOT x IN coalesce(r.orphanedSourceIds, [])] + f.sourceNodeIds,
        r.orphanedSourceIds = CASE WHEN r.orphanedSourceIds IS NULL THEN NULL
                                   ELSE [x IN r.orphanedSourceIds WHERE NOT x IN f.sourceNodeIds] END,
        r.contested = false,
        r.derivedAt = coalesce(r.derivedAt, timestamp()),
        r.rubricVersion = $rubricVersion,
        r.confidence = CASE WHEN f.confidence IS NULL THEN r.confidence ELSE f.confidence END
    RETURN s.name AS subject, r.verb AS verb, o.name AS object, r.confidence AS confidence
    """

    @classmethod
    def _normalize_fact(cls, fact) -> dict:
        """
        Accepts a fact as either a dict (subject/verb/obj/sourceNodeIds/
        confidence/subject_kind/object_kind keys) or a
        (subject, verb, obj, sourceNodeIds[, confidence]) sequence,
        validates it, and returns the canonical dict form. Entity kinds
        default to the verb-based inference table, falling back to
        'generic' for verbs the protocol does not recognize.
        """
        subject_kind = None
        object_kind = None
        if isinstance(fact, dict):
            subject = fact.get("subject")
            verb = fact.get("verb")
            obj = fact.get("obj")
            sourceNodeIds = fact.get("sourceNodeIds")
            confidence = fact.get("confidence")
            subject_kind = fact.get("subject_kind")
            object_kind = fact.get("object_kind")
        elif isinstance(fact, (list, tuple)):
            if len(fact) == 4:
                subject, verb, obj, sourceNodeIds = fact
                confidence = None
            elif len(fact) == 5:
                subject, verb, obj, sourceNodeIds, confidence = fact
            else:
                raise ValueError("Each fact must be (subject, verb, obj, sourceNodeIds[, confidence]) or an equivalent dict.")
        else:
            raise ValueError("Each fact must be a dict or a (subject, verb, obj, sourceNodeIds[, confidence]) sequence.")

        if not subject or not verb or not obj:
            raise ValueError("Each fact requires non-empty subject, verb, and obj.")
        if not sourceNodeIds:
            raise ValueError("Provenance Violation: every derived insight requires the sourceNodeIds (AST hashes) that led to the deduction.")
        for node_id in sourceNodeIds:
            if not isinstance(node_id, str) or not AST_HASH_PATTERN.match(node_id):
                # Bounded echo: enough to identify the offender, never an
                # unbounded payload in the raised message.
                echo = repr(node_id)
                if len(echo) > 80:
                    echo = echo[:80] + "..."
                raise ValueError(
                    f"Provenance Violation: sourceNodeIds element {echo} is not an AST hash "
                    f"(64 lowercase hex chars). Workspace segment ids, question ids, and any "
                    f"other identifiers are never provenance — cite the AST hashes the data "
                    f"actually came from."
                )
        if confidence is not None:
            confidence = float(confidence)
            if not 0.0 <= confidence <= 1.0:
                raise ValueError(f"confidence must be between 0.0 and 1.0, got {confidence}.")

        inferred = cls._KIND_INFERENCE.get(str(verb).lower(), ("generic", "generic"))
        subject_kind = subject_kind if subject_kind is not None else inferred[0]
        object_kind = object_kind if object_kind is not None else inferred[1]
        for kind in (subject_kind, object_kind):
            if kind not in cls.ENTITY_KINDS:
                raise ValueError(f"Invalid entity kind '{kind}': must be one of {', '.join(cls.ENTITY_KINDS)}.")

        return {
            "subject": str(subject),
            "verb": str(verb),
            "obj": str(obj),
            "sourceNodeIds": list(sourceNodeIds),
            "confidence": confidence,
            "subject_kind": subject_kind,
            "object_kind": object_kind,
        }

    def _verify_hashes_exist(self, facts: list) -> None:
        """Session 14 (§10.2): the deduped union of the batch's cited
        hashes must exist in ast_nodes before any write happens. Fail
        fast, no partial write. An infrastructure failure from the
        checker (e.g. Postgres down) propagates as a RuntimeError — it is
        never reported as a provenance verdict."""
        if self._ast_existence_check is None:
            return
        union = sorted({h for fact in facts for h in fact["sourceNodeIds"]})
        missing = json.loads(self._ast_existence_check(union))
        if missing:
            shown = ", ".join(missing[:5])
            more = f" (+{len(missing) - 5} more)" if len(missing) > 5 else ""
            raise ValueError(
                f"Provenance Violation: {len(missing)} cited sourceNodeIds hash(es) do not "
                f"exist in ast_nodes: {shown}{more}. Only hashes of verified ingested bytes "
                f"are provenance; nothing was written."
            )

    def _verify_hashes_retrieved(self, cited_hashes) -> None:
        """Session 31 (PROVENANCE_THREADING.md §5.3): citable addresses
        are constrained to the run's retrieved-address set — every cited
        hash must be one whose bytes a retrieval tool returned to this
        run. The THIRD layer, additive and order-pinned after format
        (_normalize_fact) and existence (_verify_hashes_exist). Closes
        T1 (transcription/choice: corrupted digits, scrollback hashes,
        second-hand citation of graph-surfaced provenance lists); does
        NOT close T2 (read-then-cite laundering) — that is slice (e)'s
        sampled entailment tier. Fail fast, no partial write. The check
        is in-process set membership: there is no I/O to fail, and an
        empty set refuses everything unretrieved — the safe direction."""
        if self._retrieved_addresses_check is None:
            return
        unretrieved = sorted(set(cited_hashes) - self._retrieved_addresses_check())
        if unretrieved:
            shown = ", ".join(unretrieved[:5])
            more = f" (+{len(unretrieved) - 5} more)" if len(unretrieved) > 5 else ""
            raise ValueError(
                f"Provenance Violation: {len(unretrieved)} cited sourceNodeIds hash(es) were "
                f"never retrieved by this run: {shown}{more}. A run may cite only addresses "
                f"whose bytes a retrieval tool returned to it. Call get_ast_texts on them, "
                f"confirm the bytes actually support your claim, then re-derive and cite; "
                f"nothing was written."
            )

    def _run_insight_writes(self, facts: list) -> str:
        # The single whitelisted write path opens its session with explicit
        # WRITE access; every other session in this sandbox is READ (T7).
        # Existence enforcement runs first: no write session opens for a
        # batch citing unknown hashes.
        self._verify_hashes_exist(facts)
        # Audit the cited hashes (the model's attempt), before the write —
        # laundering is about existent-but-wrong hashes, which pass the
        # existence gate and reach here.
        cited_hashes = {h for fact in facts for h in fact["sourceNodeIds"]}
        _audit_add("cited", cited_hashes)
        # Session 31 (PROVENANCE_THREADING.md slice d): the retrieval-
        # membership gate — after existence, after the cited-attempt
        # audit (the A/B eval's measure-the-attempt discipline), before
        # the experimental gates. One unretrieved hash refuses the whole
        # batch before any session opens.
        self._verify_hashes_retrieved(cited_hashes)
        # Hybrid soft-gate (experimental, opt-in): refuse to cite a hash
        # the run never read via get_ast_texts, so the model must read
        # before it cites. (Measured NOT to prevent laundering — the model
        # reads the wrong block then cites it — kept for the A/B record.)
        if CITATION_HINT_ENABLED:
            unread = sorted(cited_hashes - _read_set())
            if unread:
                shown = ", ".join(unread[:3])
                more = f" (+{len(unread) - 3} more)" if len(unread) > 3 else ""
                raise ValueError(
                    f"Citation discipline: you may cite only AST blocks you have READ this run "
                    f"via get_ast_texts. These cited hashes were never read: {shown}{more}. "
                    f"Call get_ast_texts on them, confirm the bytes actually support your claim, "
                    f"then re-derive and cite."
                )
        # Semantic entailment gate (experimental, opt-in): refuse a cited
        # block whose text does not support the claim — the only check that
        # catches read-then-cite laundering. A checker infrastructure
        # failure propagates as RuntimeError, never a provenance verdict
        # (the Session 14 discipline).
        if CITATION_ENTAIL_ENABLED and self._entailment_check is not None:
            for fact in facts:
                unsupported = self._entailment_check(
                    fact["subject"], fact["verb"], fact["obj"], fact["sourceNodeIds"]
                )
                if unsupported:
                    shown = ", ".join(unsupported[:3])
                    raise ValueError(
                        f"Citation support check: cited block(s) {shown} do not state or support "
                        f"the claim '{fact['subject']} {fact['verb']} {fact['obj']}'. Cite only "
                        f"blocks whose text actually supports the claim; drop the rest and re-derive."
                    )
        try:
            with self.driver.session(default_access_mode=WRITE_ACCESS) as session:
                result = session.run(self._WRITE_INSIGHT_QUERY, facts=facts, rubricVersion=RUBRIC_VERSION)
                return json.dumps([record.data() for record in result])
        except Exception as e:
            raise RuntimeError(f"Neo4jError while writing derived insight: {e}") from e

    def write_derived_insight(self, subject: str, verb: str, obj: str, sourceNodeIds: list, confidence: float = None,
                              subject_kind: str = None, object_kind: str = None) -> str:
        """
        The ONLY permitted write operation. Allows the RLM to append derived insights
        to the belief state graph, linking them to specific AST nodes (sourceNodeIds).

        `confidence` (optional, 0.0-1.0) is the sub-LLM's self-reported
        probability that the derivation is correct. It is stored on the
        edge and drives Phase 5 verification routing: low-confidence edges
        are re-checked eagerly, high-confidence edges are sampled. Writes
        without confidence are treated as low-confidence by the verifier.
        Every write is also stamped with the current rubric version and a
        derivedAt timestamp (first derivation only).

        `subject_kind` / `object_kind` (optional) stamp the endpoint
        Entity nodes with what they ARE (question | category_label |
        concept | generic). For has_category and mentions writes the
        kinds are inferred automatically; supply them explicitly only
        for other verbs where 'generic' would be wrong.

        Re-deriving a contested fact (one quarantined by the Phase 4
        invalidation sweep because its source bytes were orphaned by a
        document update, or disputed by the Phase 5 verifier) restores it
        to trusted state: the contested flag clears on the edge AND its
        endpoint nodes, orphaned hashes are dropped from live provenance,
        and orphanedSourceIds/rederivedAt remain as audit history. If a
        reverted document makes an old hash live again, re-citing that hash
        moves it out of orphanedSourceIds and back into sourceNodeIds.
        """
        _count_tool_call()
        fact = self._normalize_fact({
            "subject": subject, "verb": verb, "obj": obj,
            "sourceNodeIds": sourceNodeIds, "confidence": confidence,
            "subject_kind": subject_kind, "object_kind": object_kind,
        })
        return self._run_insight_writes([fact])

    def write_derived_insights(self, facts: list) -> str:
        """
        Bulk variant of write_derived_insight: writes a list of facts in a
        single Cypher UNWIND round trip. Each fact is either a dict with
        keys subject, verb, obj, sourceNodeIds, and optional confidence /
        subject_kind / object_kind, or a
        (subject, verb, obj, sourceNodeIds[, confidence]) tuple.

        Use this for sweep-sized writes (e.g. caching a whole
        classification batch): it collapses N MERGE round trips into one.
        Semantics per fact are identical to write_derived_insight,
        including the un-contest-on-rederive behavior.
        """
        _count_tool_call()
        if not facts or not isinstance(facts, (list, tuple)):
            raise ValueError("write_derived_insights requires a non-empty list of facts.")
        normalized = [self._normalize_fact(f) for f in facts]
        return self._run_insight_writes(normalized)

    def close(self):
        self.driver.close()


# --- The trellis_neo4j surface descriptor ------------------------------
#
# WHAT FILLS WHAT. rlms reserves a per-surface description slot:
# format_tools_for_prompt (rlm/environments/base_env.py) renders exactly
# one line per injected surface — the backtick-quoted name, then the
# description. Trellis passes bare values at the custom_tools seam, so
# this surface currently renders as a bare type name. These bytes are
# what fill that slot.
#
# OWNERSHIP follows SELF_DESCRIBING_SURFACES.md §9.1 — one encoding,
# owned by whoever is authoritative for the fact. Every sentence a guard
# enforces lives in _NEO4J_GUARD_EXPECTS, keyed by its guard class, and
# nowhere else. `purpose`, `whenToUse` and `seeAlso` are editorial: no
# predicate stands behind them, and going looking for one is looking for
# the wrong kind of fact rather than finding a gap in the mechanism.
#
# FIELD SHAPE IS NOT VALIDATED and nothing here should start validating
# it (SELF_DESCRIBING_SURFACES.md §11, owner, July 23, 2026): the
# descriptor is a REGISTRATION, register_surface requires only a
# non-empty name, and fields vary per surface.
#
# BRACE-FREE, EVERY STRING (.claude/rules/prompt-authoring.md rule 6):
# rlms runs .format() over the prompt these bytes land in, so no literal
# brace appears in any string below — not a doubled one either. The one
# substitution this pair needs travels in the house <<...>> idiom.
#
# WHY THE PHRASES CARRY THEIR OWN LEADING SPACE, and what owns the rest.
# `trellis_contribution.render_contribution` owns how a `contributes` list
# becomes a line, and this file states none of it: a copy here restating
# the field name, the tag set, or the join would be one rule in two
# places, which is the failure §9.1 forecloses and the failure this whole
# surface layer exists to close. It was one, briefly — it named a field
# `line` and a join of one space, both wrong against the shipped frame —
# and a second composer written to it would have diverged silently.
#
# What is this file's own business: a phrase is empty exactly when the
# guard behind it is not wired on this holder, and the frame contributes
# no bytes of its own, so each phrase begins with the space that
# separates it from whatever precedes it. An unwired guard then costs
# nothing rather than leaving a gap. That is the converse of the bijection
# orphan SELF_DESCRIBING_SURFACES.md §10 recorded: a run is never told a
# rule that cannot fire on it, and never refused by one it was not told.
#
# WHAT IS DELIBERATELY ABSENT. The Cypher mutation blocklist, the four
# entity kinds, and the 0.0-1.0 confidence bound are each guard-backed
# AND already stated in the kernel TOOLS manifest (trellis_agent.py
# _ADDENDUM_BASE_PREFIX). Restating one here would be the second encoding
# §9.1 forecloses, so the manifest keeps them until a pass that owns
# those bytes moves them.
NEO4J_DESCRIPTOR = {
    "name": "trellis_neo4j",
    "purpose": ("the belief graph — Cypher reads, plus the one derivation "
                "write path."),
    "whenToUse": ("you need to find which AST addresses bear on the task, "
                  "or to cache a fact you derived so a later run gets it "
                  "without deriving it again"),
    "seeAlso": ["trellis_postgres"],
    # WHAT THIS SLOT SELECTS: ONE guard-owned phrase, the retrieval
    # closure. Thirteen surfaces share CONTRIBUTION_BUDGET, so the slot
    # is an ORIENTING line rather than this surface's account
    # (trellis_contribution.py's header states the split), and the one
    # phrase that earns it is the one no refusal can deliver in time to
    # change the first attempt: a run composing a batch from hashes a
    # Cypher result named has already done the wrong thing, and the
    # closure is what stops it beforehand.
    #
    # THE FOUR PHRASES THIS SLOT LEAVES UNSELECTED, and what states each:
    #   * hash_format — the _normalize_fact raise, which names the
    #     offending element, the 64-lowercase-hex shape, and the
    #     identifier classes that are never provenance;
    #   * existence — the _verify_hashes_exist raise; it also never
    #     renders on a shipped run, since trellis_agent wires
    #     retrieved_addresses_check unconditionally and the closure
    #     suppresses it (derive_neo4j_expects);
    #   * entailment — the per-block refusal the checker raises, on the
    #     TRELLIS_CITATION_ENTAIL runs where it is wired at all;
    #   * batch_atomic — atomicity triggers no refusal of its own, and
    #     both provenance gates end their message with "nothing was
    #     written".
    # Each stays in _NEO4J_GUARD_EXPECTS as the one encoding of it
    # (§9.1); what the slot no longer does is spend primacy bytes on a
    # sentence its own refusal delivers in full at the point of use.
    "contributes": [
        ("descriptor", "purpose"),
        ("expects", "retrieval_closure"),
    ],
}

# Guard-owned phrases: ONE encoding per guard class, keyed by the guard
# that is authoritative for it. Granularity is the class, not the raise
# site — the textedit precedent (SELF_DESCRIBING_SURFACES.md §10,
# finding 5).
_NEO4J_GUARD_EXPECTS = {
    # _normalize_fact's AST_HASH_PATTERN loop: an element that is not 64
    # lowercase hex characters refuses the batch, echoing the offender
    # bounded. Always live — this check has no injection seam.
    # Compressed July 25, 2026: the format itself is the bound that makes
    # the refusal predictable, and it stays. What came out is the trailing
    # "any other identifier refuses" — the raise names the offending
    # element and adds "Workspace segment ids, question ids, and any other
    # identifiers are never provenance", so the slot states the shape and
    # the refusal states the consequence.
    "hash_format": (" sourceNodeIds elements are 64-lowercase-hex AST "
                    "hashes."),
    # _verify_hashes_retrieved: cited addresses must be members of the
    # run's retrieved set, which get_ast_texts keys, get_ast_blocks block
    # ids and vector_search result ids feed. run_cypher deliberately does
    # NOT feed it (the module comment at _retrieved_addresses), which is
    # the case the second sentence names — the T1 closure's second-hand
    # citation of a graph-surfaced provenance list.
    # BOTH clauses survive compression, in fewer words. The first is the
    # closure itself; the second is the case a run cannot infer from it —
    # run_cypher surfaces sourceNodeIds as a property WITHOUT feeding the
    # retrieved set, so a hash the model has plainly "seen" is still
    # uncitable. That distinction changes what the model does before any
    # refusal fires, which is what earns it the bytes, and "not ones
    # Cypher surfaced" names the same set the old "a hash on a Cypher
    # property is a reference, not bytes" named. The remedy is in the
    # raise ("Call get_ast_texts on them, confirm the bytes actually
    # support your claim, then re-derive and cite"), and "retrieved" is
    # load-bearing over "read": vector_search result ids join the
    # retrieved set too, so narrowing the verb would narrow the bound.
    "retrieval_closure": (" Cite only addresses whose bytes you retrieved "
                          "this run, not ones Cypher surfaced."),
    # _verify_hashes_exist: the deduped union of the batch must exist in
    # ast_nodes before any write session opens. Rendered only where it is
    # the live bound — see derive_neo4j_expects for why the retrieval
    # closure suppresses it.
    "existence": (" A well-formed hash that is not in the store refuses."),
    # The experimental semantic gate: _run_insight_writes calls the
    # injected checker only when CITATION_ENTAIL_ENABLED is set AND a
    # checker was injected, and refuses each block whose text the checker
    # reports as not supporting the claim.
    "entailment": (" Each cited block is also checked for whether its text "
                   "supports the claim."),
    # _run_insight_writes runs every check above over the whole batch's
    # deduped citations BEFORE the WRITE session opens, so a refused
    # batch leaves nothing partial behind (substrate-writes rule 4).
    "batch_atomic": (" One refused address ends the whole batch before any "
                     "write."),
}


# One call site, one commitment: bound here, where the surface is
# defined, so the coverage diagnostic and later llm_help find it without
# anything being wired by hand elsewhere.
register_surface(NEO4J_DESCRIPTOR)


def derive_neo4j_expects(neo4j):
    """The guard-derived half of this surface's description
    (HARNESS_SELF_MODEL.md §2: the same code that refuses is the code
    that explains).

    Each conditional phrase is selected by the SAME state its guard
    reads, so the description and the refusal cannot drift apart (§2.1):
    the retrieval closure by the injected `retrieved_addresses_check`,
    the existence sentence by the injected `ast_existence_check`, and
    the entailment sentence by the module flag and the injected checker
    that `_run_insight_writes` tests together. A guard that is not wired
    on this holder contributes the empty string rather than a sentence.

    The retrieval closure SUPPRESSES the existence sentence, because an
    address whose bytes a retrieval tool returned is by construction one
    the store holds: with both wired, the weaker sentence changes no
    decision the stronger one has not already changed, and spending a
    line on it is the census entry that exists to raise the count.

    Composed by code, never authored by the model."""
    expects = dict(_NEO4J_GUARD_EXPECTS)
    retrieval_wired = getattr(neo4j, "_retrieved_addresses_check", None) is not None
    existence_wired = getattr(neo4j, "_ast_existence_check", None) is not None
    entailment_wired = (CITATION_ENTAIL_ENABLED
                        and getattr(neo4j, "_entailment_check", None) is not None)
    if not retrieval_wired:
        expects["retrieval_closure"] = ""
    if retrieval_wired or not existence_wired:
        expects["existence"] = ""
    if not entailment_wired:
        expects["entailment"] = ""
    return expects


class TrellisPostgres:
    def __init__(self, retrieval_discipline=False, retrieval_budget=None):
        # Session 33 (RETRIEVAL_DISCIPLINE.md §5): held-state dedup and
        # the per-run budget activate together through this one explicit
        # constructor decision — the retrieved_addresses_check injection
        # mold. The default (False) is byte-identical to before the
        # machinery existed: bare construction in drills, operator
        # scripts, and harness paths records nothing and refuses
        # nothing. trellis_agent.py wires it on for research runs.
        # Validated BEFORE the connection opens so a refused budget
        # never leaks one.
        self._retrieval_discipline = bool(retrieval_discipline)
        if retrieval_budget is None:
            self._retrieval_budget = RETRIEVAL_BUDGET_DEFAULT
        else:
            budget = int(retrieval_budget)
            if budget < 1 or budget > RETRIEVAL_BUDGET_MAX:
                raise ValueError(
                    f"retrieval_budget must be in [1, {RETRIEVAL_BUDGET_MAX}], got {budget}."
                )
            self._retrieval_budget = budget
        # Basic connection string assuming local defaults or env var
        dsn = os.getenv("PG_DSN", "dbname=trellis_db user=trellis_user password=trellis_password host=localhost port=5433")
        self.conn = psycopg2.connect(dsn)

    def _discipline_check_budget(self):
        """The per-run budget gate (record §4): budget N serves N
        byte-returning fetches; the next fetch refuses BEFORE any I/O,
        with counts and a bounded held-root echo. Runs after the dedup
        check — a repeat gets the dedup refusal, whose teaching is the
        actionable one."""
        with _held_lock:
            if _held["fetches"] < self._retrieval_budget:
                return
            _held["budget_refusals"] += 1
            fetches = _held["fetches"]
            counts = (len(_held["addresses"]), len(_held["roots"]), len(_held["queries"]))
            roots_echo = _bounded_echo(sorted(_held["roots"]))
        raise ValueError(
            f"Retrieval Discipline: the per-run retrieval budget of "
            f"{self._retrieval_budget} fetches is exhausted ({fetches} served: "
            f"{counts[0]} addresses, {counts[1]} block roots, {counts[2]} searches"
            f"{'; roots held: ' + roots_echo if roots_echo else ''}). "
            f"Work from the variables holding what you already retrieved — "
            f"re-derive in code instead of re-fetching."
        )

    def fetch_texts(self, hashes: list) -> dict:
        """Reconstructed block text for each hash — {id: text}. NOT counted
        as a tool call and NOT audited: harness-side plumbing (used by the
        entailment checker) that must not pollute the citation audit or the
        provenance protocol. Reconstructs text from the full stored node so
        markdown/container blocks (whose text lives in children) read back
        correctly, not as NULL."""
        if not hashes:
            return {}
        with self.conn.cursor() as cur:
            cur.execute("SELECT id, data FROM ast_nodes WHERE id = ANY(%s)", (list(hashes),))
            return {row[0]: _node_text(row[1]) for row in cur.fetchall()}

    def get_ast_texts(self, hashes: list) -> str:
        """
        Fetches the exact text blocks for a given list of AST node hashes (IDs).
        Returns a JSON string mapping node ID to its text content.
        """
        _count_tool_call()
        if not hashes:
            return "{}"

        # Session 33 (record §2.2): full-repeat dedup — refuse ONLY when
        # every requested hash is already held; a call that could serve
        # any new bytes passes in full, held hashes included, so the
        # returned bytes of a served call are byte-identical to a bare
        # fetch. Identity is the requested set (the model's assertion);
        # padding a repeat with a never-held hash evades the dedup by
        # design — teaching machinery, not a security boundary.
        if self._retrieval_discipline:
            requested = {h for h in hashes if isinstance(h, str)}
            with _held_lock:
                full_repeat = bool(requested) and requested <= _held["addresses"]
                if full_repeat:
                    _held["dedup_refusals"] += 1
            if full_repeat:
                raise ValueError(
                    f"Retrieval Discipline: all {len(requested)} requested hash(es) "
                    f"were already retrieved this run: {_bounded_echo(sorted(requested))}. "
                    f"Reuse the variable holding the earlier get_ast_texts/get_ast_blocks "
                    f"return — re-derive from it in code instead of re-fetching."
                )
            self._discipline_check_budget()

        try:
            # Reconstruct text from the full node (not data->>'content',
            # which is NULL for markdown/container blocks whose text lives
            # in child nodes — a provenance defect: the RLM could not read
            # markdown or promoted-research bytes it is meant to cite).
            texts = self.fetch_texts(hashes)
            # Read-set: the hashes the run actually retrieved text for.
            _audit_add("read", list(texts.keys()))
            if self._retrieval_discipline:
                with _held_lock:
                    _held["addresses"].update(texts.keys())
                    if texts:
                        _held["fetches"] += 1
            return json.dumps(texts)
        except Exception as e:
            # Roll back so the aborted transaction does not poison the
            # agent's next (corrected) query, then raise for the REPL
            # feedback loop.
            self.conn.rollback()
            raise RuntimeError(f"PostgresError while fetching AST texts: {e}") from e

    def get_ast_blocks(self, root_hash: str) -> str:
        """
        Fetches a document's extraction blocks IN DOCUMENT ORDER from its
        root AST hash. Returns a JSON list of objects with keys id (the
        block's own AST hash — the same citable ids get_ast_texts
        exposes), type (paragraph, heading, listItem, code, ...), and
        text (reconstructed exactly like get_ast_texts).

        Session 24 (CODE_MEDIATED_TEXT.md): the boundary-aware read. The
        root-hash reconstruction concatenates blocks with UNMARKED
        boundaries, so re-deriving section structure from it with line-
        anchored patterns fails; this returns the block structure the
        engine already has — walk the ordered blocks in code instead.
        """
        _count_tool_call()
        if not isinstance(root_hash, str):
            raise ValueError(
                "get_ast_blocks takes ONE root hash string; pass a document's root "
                "hash (use get_ast_texts for a list of block hashes)."
            )
        # Session 33 (record §2.3): per-root dedup — the measured repeat
        # class (the Session 28 frank-corpus re-reads were get_ast_blocks
        # calls on the same root). A failed call marks nothing.
        if self._retrieval_discipline:
            with _held_lock:
                repeat = root_hash in _held["roots"]
                if repeat:
                    _held["dedup_refusals"] += 1
            if repeat:
                raise ValueError(
                    f"Retrieval Discipline: get_ast_blocks already served root "
                    f"{root_hash} this run. Reuse the variable holding the earlier "
                    f"blocks list — re-derive from it in code instead of re-fetching."
                )
            self._discipline_check_budget()
        try:
            with self.conn.cursor() as cur:
                cur.execute("SELECT data FROM ast_nodes WHERE id = %s", (root_hash,))
                row = cur.fetchone()
        except Exception as e:
            self.conn.rollback()
            raise RuntimeError(f"PostgresError while fetching AST blocks: {e}") from e
        if row is None:
            raise ValueError(
                f"No AST node exists for hash {root_hash!r}; pass a document's root hash."
            )
        blocks = blocks_from_root(row[0])
        # Read-set semantics match get_ast_texts: the run retrieved these
        # blocks' bytes, so they join the citation audit's read bucket.
        _audit_add("read", [b["id"] for b in blocks if isinstance(b["id"], str)])
        if self._retrieval_discipline:
            with _held_lock:
                _held["roots"].add(root_hash)
                # The blocks' bytes were served, so their ids join held
                # addresses: a later get_ast_texts on exactly these ids
                # is a repeat by the §2.2 rule. The root argument itself
                # never joins — its reconstruction was not returned (the
                # Session 30 retrieval-set rule has the same shape).
                _held["addresses"].update(
                    b["id"] for b in blocks if isinstance(b["id"], str))
                if blocks:
                    _held["fetches"] += 1
        return json.dumps(blocks)

    def ast_hashes_exist(self, hashes: list) -> str:
        """Returns a JSON list of the hashes that do NOT exist in
        ast_nodes (empty list means all exist). Write-path plumbing for
        the Session 14 provenance existence check — deliberately not
        counted as a database tool call: reading it never satisfies the
        provenance protocol, and the write it guards already counts."""
        if not hashes:
            return "[]"
        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM ast_nodes WHERE id = ANY(%s)",
                    (list(hashes),)
                )
                found = {row[0] for row in cur.fetchall()}
                return json.dumps([h for h in hashes if h not in found])
        except Exception as e:
            self.conn.rollback()
            raise RuntimeError(f"PostgresError while checking AST hash existence: {e}") from e

    def vector_search(self, query: str) -> str:
        """
        Performs a hybrid pgvector search over the AST embeddings.
        This provides semantic fallback if the Graph traversal fails or needs grounding.
        """
        _count_tool_call()
        # Session 33 (record §2.4): exact-query-match dedup ONLY — the
        # search is deterministic over an unchanged store, so re-asking
        # the identical string re-spends an embedding call to learn
        # nothing. Semantic near-duplicate detection is excluded by
        # decision: not plumbing. The refusal fires BEFORE the paid
        # embedding call.
        if self._retrieval_discipline:
            with _held_lock:
                repeat = query in _held["queries"]
                if repeat:
                    _held["dedup_refusals"] += 1
            if repeat:
                raise ValueError(
                    "Retrieval Discipline: this exact query was already searched "
                    "this run. Reuse the variable holding the earlier results; "
                    "rephrase only if you genuinely need different evidence."
                )
            self._discipline_check_budget()
        # Assuming we need to get embedding from OpenAI for the query first,
        # or assuming the query string itself is handled if there is an embedding model in postgres (pgvector doesn't do it automatically)
        # To avoid adding heavy ML deps here, we will call OpenAI embeddings API to get the vector.
        import openai
        try:
            client = openai.OpenAI()
            embed_res = client.embeddings.create(
                model="text-embedding-3-small",
                input=query
            )
            query_embedding = embed_res.data[0].embedding
            
            with self.conn.cursor() as cur:
                # The schema function owns pgvector cosine ordering so the
                # Python and TypeScript clients cannot drift.
                cur.execute(
                    "SELECT id, content FROM search_ast_nodes(%s::vector, 3)",
                    (json.dumps(query_embedding),)
                )
                results = cur.fetchall()
                # Search-set: hashes surfaced by semantic search (module
                # #1 laundered by citing these without reading them).
                _audit_add("search", [row[0] for row in results])
                if self._retrieval_discipline:
                    with _held_lock:
                        # The query joins held state even on an empty
                        # result (re-asking is the same repeat class);
                        # only byte-returning fetches consume budget.
                        # Result ids deliberately do NOT join held
                        # addresses — reading a hit via get_ast_texts is
                        # the confirm-before-cite pattern the write gate
                        # teaches (record §2.4).
                        _held["queries"].add(query)
                        if results:
                            _held["fetches"] += 1
                # search_ast_nodes returns data->>'content', which is NULL
                # for markdown/container blocks; reconstruct those so the
                # preview is real text, not null (the get_ast_texts fix).
                need = [row[0] for row in results if row[1] is None]
                recon = self.fetch_texts(need) if need else {}
                return json.dumps([
                    {"id": row[0], "content": row[1] if row[1] is not None else recon.get(row[0], "")}
                    for row in results
                ])
        except Exception as e:
            self.conn.rollback()
            raise RuntimeError(f"PostgresError during vector search: {e}") from e

    def close(self):
        self.conn.close()


# --- The trellis_postgres surface descriptor ---------------------------
#
# Same ownership split, same brace rule, same line contract as the
# trellis_neo4j block above; the reasoning is written out there once.
#
# WHAT IS DELIBERATELY ABSENT. get_ast_blocks refuses a non-string
# argument and a hash with no ast_nodes row, but the kernel TOOLS
# manifest already names the parameter `root_hash` and says the call
# returns a document's blocks — so a sentence here would be a second
# encoding of a fact the manifest owns (§9.1), not a bound the model
# would otherwise meet unwarned. The two phrases below are the ones no
# default prompt byte states today.
POSTGRES_DESCRIPTOR = {
    "name": "trellis_postgres",
    "purpose": ("the byte layer — text at AST addresses, and search by "
                "meaning."),
    "whenToUse": ("you hold addresses and need the bytes behind them, or "
                  "you hold none yet and need to find some; the graph "
                  "tells you which addresses exist and this surface is "
                  "where their bytes come from"),
    "seeAlso": ["trellis_neo4j"],
    # WHAT THIS SLOT SELECTS: ONE guard-owned phrase, the retrieval
    # budget. Thirteen surfaces share CONTRIBUTION_BUDGET, so the slot
    # orients rather than accounts, and the budget is the one bound here
    # NO refusal can deliver in time — a run learns its budget from the
    # exhaustion message only once the budget is already gone, whereas
    # the number in the line changes how the first fetch is planned.
    #
    # `repeat_refusal` is unselected and the get_ast_texts /
    # get_ast_blocks / vector_search raises state it in full at the
    # moment it bears on a decision, each naming what was already served
    # and ending with the remedy ("Reuse the variable holding the earlier
    # get_ast_texts/get_ast_blocks return — re-derive from it in code
    # instead of re-fetching"). The phrase stays below as the one
    # encoding of it (§9.1).
    "contributes": [
        ("descriptor", "purpose"),
        ("expects", "retrieval_budget"),
    ],
}

# The one substitution these bytes carry, in the house <<...>> idiom
# (.claude/rules/prompt-authoring.md rule 6) rather than a format field:
# angle brackets survive rlms's .format() call, a brace would not.
_RETRIEVAL_BUDGET_TOKEN = "<<RETRIEVAL_BUDGET>>"

_POSTGRES_GUARD_EXPECTS = {
    # The three dedup predicates, one guard class: get_ast_texts refuses
    # a request whose every hash is already held, get_ast_blocks a root
    # already served, vector_search a query string already run. Held
    # state holds identities and never content, so a repeat REFUSES
    # rather than replaying — there is no store mirror to serve from.
    # Compressed July 25, 2026: the one-line slot is an ORIENTING line,
    # not an account. Which of the three surfaces refused, and on what,
    # is in the refusal message the model reads at the moment it matters;
    # restating the enumeration here spends primacy bytes on something
    # already delivered at the point of use. The same pass took the
    # remedy clause out for the same reason — get_ast_texts's refusal
    # ends "Reuse the variable holding the earlier get_ast_texts/
    # get_ast_blocks return — re-derive from it in code instead of
    # re-fetching", so the line keeps only what makes that refusal
    # PREDICTABLE and lets the refusal carry what to do about it.
    # July 25, 2026, second pass: the phrase is no longer pulled into the
    # one-line slot at all (see POSTGRES_DESCRIPTOR above). It stays here
    # as the one encoding of the dedup class, for the addendum and
    # llm_help paths that read derived expectations.
    "repeat_refusal": (" A fetch this run already served refuses."),
    # _discipline_check_budget: budget N serves N byte-returning fetches
    # and the next one refuses before any I/O. Only a call that returned
    # bytes increments the counter, which is why the sentence counts
    # fetches rather than calls. The number is run state, spliced by
    # derive_postgres_expects out of the same attribute the predicate
    # compares against. The NUMBER is what this phrase exists to carry —
    # it is the one thing here no refusal can deliver in time, since a
    # run learns its budget from the exhaustion message only once the
    # budget is already gone. The advice that followed it is in that
    # message ("Work from the variables holding what you already
    # retrieved — re-derive in code instead of re-fetching"), so the
    # slot keeps the count and the refusal keeps the remedy.
    "retrieval_budget": (" This run may spend " + _RETRIEVAL_BUDGET_TOKEN
                         + " byte-returning fetches; the next refuses."),
}


register_surface(POSTGRES_DESCRIPTOR)


def derive_postgres_expects(postgres):
    """The guard-derived half of this surface's description.

    Both phrases are selected by `_retrieval_discipline` — the SAME bool
    that decides whether the dedup and budget checks run at all — and
    the budget figure is read from `_retrieval_budget`, the SAME
    attribute `_discipline_check_budget` compares the fetch count
    against. A bare-constructed instance refuses neither, so it
    describes neither, and its line stays what it was before this
    machinery existed (the byte-identical-when-absent mold).

    The budget number is run state and is never stated in the
    descriptor: an operator raising TRELLIS_RETRIEVAL_BUDGET_PER_RUN
    moves the sentence and the refusal together or moves neither.

    Composed by code, never authored by the model."""
    expects = dict(_POSTGRES_GUARD_EXPECTS)
    if not getattr(postgres, "_retrieval_discipline", False):
        expects["repeat_refusal"] = ""
        expects["retrieval_budget"] = ""
        return expects
    budget = getattr(postgres, "_retrieval_budget", RETRIEVAL_BUDGET_DEFAULT)
    expects["retrieval_budget"] = expects["retrieval_budget"].replace(
        _RETRIEVAL_BUDGET_TOKEN, str(budget))
    return expects
