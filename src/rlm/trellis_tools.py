import os
import json
import threading
from neo4j import GraphDatabase
import psycopg2

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
    def __init__(self):
        # Retrieve config from environment variables
        uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
        user = os.getenv("NEO4J_USER", "neo4j")
        password = os.getenv("NEO4J_PASSWORD", "trellis_password")
        self.driver = GraphDatabase.driver(uri, auth=(user, password))

    def run_cypher(self, query: str) -> str:
        """
        Executes a read-only Cypher query against the Trellis Knowledge Graph.
        """
        _count_tool_call()
        # Read-only enforcement block
        forbidden_keywords = ["CREATE", "MERGE", "DELETE", "SET", "DROP", "REMOVE", "DETACH"]
        upper_query = query.upper()
        for keyword in forbidden_keywords:
            # Basic check for token isolation (e.g. not matching 'SECRETARY')
            # A more robust check might use regex \bKEYWORD\b
            import re
            if re.search(r'\b' + keyword + r'\b', upper_query):
                raise ValueError(f"Security Violation: Mutation keyword '{keyword}' blocked. Use write_derived_insight for writing.")
        
        # Database errors must RAISE so the REPL surfaces a real Python
        # traceback that the RLM loop intercepts and feeds back to the
        # agent for self-correction (Evaluation-as-a-Loop).
        try:
            with self.driver.session() as session:
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
    # dropped from node provenance, contested clears once no orphaned
    # provenance remains, and contestedAt/orphanedSourceIds stay behind
    # as audit history.
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
        s.sourceNodeIds = [x IN coalesce(s.sourceNodeIds, []) + [y IN f.sourceNodeIds WHERE NOT y IN coalesce(s.sourceNodeIds, [])]
                           WHERE NOT x IN coalesce(s.orphanedSourceIds, [])],
        o.sourceNodeIds = [x IN coalesce(o.sourceNodeIds, []) + [y IN f.sourceNodeIds WHERE NOT y IN coalesce(o.sourceNodeIds, [])]
                           WHERE NOT x IN coalesce(o.orphanedSourceIds, [])],
        s.contested = false,
        o.contested = false,
        r.rederivedAt = CASE WHEN coalesce(r.contested, false) THEN timestamp() ELSE r.rederivedAt END,
        r.sourceNodeIds = [x IN coalesce(r.sourceNodeIds, []) + [y IN f.sourceNodeIds WHERE NOT y IN coalesce(r.sourceNodeIds, [])]
                           WHERE NOT x IN coalesce(r.orphanedSourceIds, [])],
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

    def _run_insight_writes(self, facts: list) -> str:
        try:
            with self.driver.session() as session:
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
        and orphanedSourceIds/rederivedAt remain as audit history.
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
                # Use pgvector's <=> operator for cosine distance
                cur.execute(
                    """
                    SELECT id, data->>'content' as content 
                    FROM ast_nodes 
                    WHERE embedding IS NOT NULL
                    ORDER BY embedding <=> %s::vector 
                    LIMIT 3;
                    """,
                    (json.dumps(query_embedding),)
                )
                results = cur.fetchall()
                return json.dumps([{"id": row[0], "content": row[1]} for row in results])
        except Exception as e:
            self.conn.rollback()
            raise RuntimeError(f"PostgresError during vector search: {e}") from e

    def close(self):
        self.conn.close()
