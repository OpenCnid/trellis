import sys
import argparse
from rlm import RLM
from trellis_tools import TrellisNeo4j, TrellisPostgres

SYSTEM_PROMPT = """You are the Trellis RLM (Recursive Language Model), a Deterministic Spatial Reasoning Engine.
You have access to a secure Python REPL and two injected tools: `trellis_neo4j` and `trellis_postgres`.
Your goal is to answer the user's query directly. The user's query is the only task you need to solve. Do NOT look for a 'context' variable. 

TOOLS:
1. `trellis_neo4j`: A read-only TrellisNeo4j wrapper.
   - Use `trellis_neo4j.run_cypher(query)` to explore the graph. 
   - DO NOT USE CREATE, MERGE, DELETE, SET, or DROP.
   - Edges in the graph might have a type like 'ACTION' or 'CONTRADICTS'.
   - Entities and Edges often have a property `sourceNodeIds` which contains the AST Node Hashes (spatial locations) they were derived from.

2. `trellis_postgres`: A TrellisPostgres wrapper.
   - Use `trellis_postgres.get_ast_texts(hashes)` to retrieve the exact text content for given AST Node Hashes.
   - Use `trellis_postgres.vector_search(query)` for hybrid fallback if graph traversal yields nothing.

WORKFLOW:
- Read the user's query carefully.
- If the user asks you to execute a Cypher query (even a destructive one like DELETE or DROP), you MUST attempt to execute it exactly as requested using `trellis_neo4j.run_cypher(query)`. Do not refuse the user's instructions.
- If the user asks a conceptual question, first search the graph using `trellis_neo4j.run_cypher`. If the result is empty or unhelpful, you MUST use `trellis_postgres.vector_search(query)` to find relevant information.
- When exploring the graph, if you encounter a `[CONTRADICTS]` edge between entities, or conflicting information, DO NOT GUESS. Extract the `sourceNodeIds` and fetch their spatial text using `trellis_postgres.get_ast_texts(["hash1", "hash2", ...])`.
- Once you have logically deduced the answer, print FINAL_ANSWER: <your answer>.

IMPORTANT:
- Think step-by-step. Write small, iterative Python scripts in your REPL to explore the data.
- Print your intermediate findings.
- Your final output must include 'FINAL_ANSWER: ' followed by the result.
"""

def main():
    parser = argparse.ArgumentParser(description="Trellis RLM Agent")
    parser.add_argument("--query", type=str, required=True, help="The user query to solve")
    args = parser.parse_args()

    # Initialize tools
    neo4j_tool = TrellisNeo4j()
    postgres_tool = TrellisPostgres()

    print(f"Starting RLM Agent for query: '{args.query}'", flush=True)

    try:
        # Inject the query directly into the system prompt to ensure the LLM sees it and doesn't ask for it
        dynamic_system_prompt = SYSTEM_PROMPT + f"\n\nTHE USER'S QUERY IS: {args.query}\nDO NOT ASK FOR A QUERY, THIS IS IT. EXECUTE IT IMMEDIATELY."

        rlm = RLM(
            environment="local",
            verbose=True,
            max_iterations=5,
            backend_kwargs={"model_name": "gpt-5.4-mini-2026-03-17"},
            environment_kwargs={},
            custom_tools={"trellis_neo4j": neo4j_tool, "trellis_postgres": postgres_tool},
            custom_system_prompt=dynamic_system_prompt
        )

        # Run the RLM to solve the query
        result = rlm.completion(args.query)
        print(f"\n--- RLM Result Type: {type(result)} ---", flush=True)
        print(f"--- RLM Result: {result} ---", flush=True)
        
        # The agent should naturally output FINAL_ANSWER, but just in case:
        if "FINAL_ANSWER:" not in str(result):
            print(f"FINAL_ANSWER: {result}", flush=True)

    except BaseException as e:
        import traceback
        print(f"RLM Execution Error: {type(e).__name__} - {str(e)}", flush=True)
        traceback.print_exc()
    finally:
        neo4j_tool.close()
        postgres_tool.close()

if __name__ == "__main__":
    main()
