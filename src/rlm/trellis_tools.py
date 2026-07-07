import os
import json
import re
import threading
from neo4j import GraphDatabase, READ_ACCESS, WRITE_ACCESS
import psycopg2

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

class TrellisNeo4j:
    def __init__(self, ast_existence_check=None):
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

    def _run_insight_writes(self, facts: list) -> str:
        # The single whitelisted write path opens its session with explicit
        # WRITE access; every other session in this sandbox is READ (T7).
        # Existence enforcement runs first: no write session opens for a
        # batch citing unknown hashes.
        self._verify_hashes_exist(facts)
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


class TrellisPostgres:
    def __init__(self):
        # Basic connection string assuming local defaults or env var
        dsn = os.getenv("PG_DSN", "dbname=trellis_db user=trellis_user password=trellis_password host=localhost port=5433")
        self.conn = psycopg2.connect(dsn)

    def get_ast_texts(self, hashes: list) -> str:
        """
        Fetches the exact text blocks for a given list of AST node hashes (IDs).
        Returns a JSON string mapping node ID to its text content.
        """
        _count_tool_call()
        if not hashes:
            return "{}"
        
        try:
            with self.conn.cursor() as cur:
                # ast_nodes table has: id, document_id, data, embedding
                # We need data->>'content'
                cur.execute(
                    "SELECT id, data->>'content' FROM ast_nodes WHERE id = ANY(%s)",
                    (hashes,)
                )
                results = cur.fetchall()
                # Return dict of {id: content}
                return json.dumps({row[0]: row[1] for row in results})
        except Exception as e:
            # Roll back so the aborted transaction does not poison the
            # agent's next (corrected) query, then raise for the REPL
            # feedback loop.
            self.conn.rollback()
            raise RuntimeError(f"PostgresError while fetching AST texts: {e}") from e

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
                return json.dumps([{"id": row[0], "content": row[1]} for row in results])
        except Exception as e:
            self.conn.rollback()
            raise RuntimeError(f"PostgresError during vector search: {e}") from e

    def close(self):
        self.conn.close()
