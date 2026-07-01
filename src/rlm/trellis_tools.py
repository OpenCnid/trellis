import os
import json
from neo4j import GraphDatabase
import psycopg2

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
        # Read-only enforcement block
        forbidden_keywords = ["CREATE", "MERGE", "DELETE", "SET", "DROP", "REMOVE", "DETACH"]
        upper_query = query.upper()
        for keyword in forbidden_keywords:
            # Basic check for token isolation (e.g. not matching 'SECRETARY')
            # A more robust check might use regex \bKEYWORD\b
            import re
            if re.search(r'\b' + keyword + r'\b', upper_query):
                raise ValueError(f"Security Violation: Mutation keyword '{keyword}' blocked. Use write_derived_insight for writing.")
        
        try:
            with self.driver.session() as session:
                result = session.run(query)
                records = [record.data() for record in result]
                return json.dumps(records)
        except Exception as e:
            return f"Error executing Cypher query: {str(e)}"

    def write_derived_insight(self, subject: str, verb: str, obj: str, sourceNodeIds: list) -> str:
        """
        The ONLY permitted write operation. Allows the RLM to append derived insights 
        to the belief state graph, linking them to specific AST nodes (sourceNodeIds).
        """
        query = """
        MERGE (s:Entity {name: toLower($subject)})
        MERGE (o:Entity {name: toLower($obj)})
        MERGE (s)-[r:ACTION {type: toLower($verb)}]->(o)
        SET s.sourceNodeIds = coalesce(s.sourceNodeIds, []) + [x IN $sourceNodeIds WHERE NOT x IN coalesce(s.sourceNodeIds, [])],
            o.sourceNodeIds = coalesce(o.sourceNodeIds, []) + [x IN $sourceNodeIds WHERE NOT x IN coalesce(o.sourceNodeIds, [])],
            r.sourceNodeIds = coalesce(r.sourceNodeIds, []) + [x IN $sourceNodeIds WHERE NOT x IN coalesce(r.sourceNodeIds, [])]
        RETURN s, r, o
        """
        try:
            with self.driver.session() as session:
                result = session.run(query, subject=subject, verb=verb, obj=obj, sourceNodeIds=sourceNodeIds)
                return json.dumps([record.data() for record in result])
        except Exception as e:
            return f"Error writing insight: {str(e)}"

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
            return f"Error fetching AST texts: {str(e)}"

    def vector_search(self, query: str) -> str:
        """
        Performs a hybrid pgvector search over the AST embeddings.
        This provides semantic fallback if the Graph traversal fails or needs grounding.
        """
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
            return f"Error performing vector search: {str(e)}"

    def close(self):
        self.conn.close()
