# Phase 3 PRD: The Trellis RLM Harness

## 1. Product Vision
Trellis is currently a passive **Deterministic Spatial Reasoning Engine**. In Phase 3, we are evolving it into an **Active Autonomous System**. 

Standard "Agentic Search" (grep loops) is fundamentally limited—it blindly retrieves text, thrashes the LLM's context window, and fails at multi-hop reasoning. We are replacing passive retrieval with a **Recursive Language Model (RLM)** harness. By giving the LLM a secure Python REPL (Read-Eval-Print Loop), the AI will autonomously write code to navigate our Neo4j graph, evaluate spatial AST text from PostgreSQL, execute sub-LLM calls, and loop until it deduces a definitive answer.

## 2. Architectural Shift
We are abandoning restrictive JSON tool-calling (OpenAI Functions) for retrieval.
Instead, we are adopting the official **`rlms` Python library** (from MIT CSAIL). 
Because our core engine is Node.js, we will use a hybrid orchestration model:
- **Node.js (Express/BullMQ)** remains the traffic cop and ingestion orchestrator.
- **Python (RLM/REPL)** becomes the retrieval and reasoning engine, spawned dynamically via Node's `child_process`.

## 3. Milestones

### Milestone 1: Python Database Wrappers
We must build Python-native interfaces that expose our databases safely to the REPL.
* **`TrellisNeo4j`:** A Python class exposing `run_cypher(query)` to navigate the semantic graph.
* **`TrellisPostgres`:** A Python class exposing `fetch_ast_text(hashes)` and `vector_search(query)` for physical and hybrid semantic lookup.

### Milestone 2: The RLM Agent & REPL Sandbox
We will instantiate the RLM using the `rlms` library.
* We will inject `TrellisNeo4j` and `TrellisPostgres` as `custom_tools` directly into the local REPL environment.
* We will craft a highly specific System Prompt instructing the RLM to use these tools programmatically, leveraging `llm_query()` to analyze intermediate results without polluting its own context window.

### Milestone 3: Node.js Orchestration & API
We will bridge the Node.js and Python ecosystems.
* **`POST /api/rlm-ask`:** A new endpoint that accepts a complex user query.
* The Node server will spawn the `trellis_agent.py` process, stream the REPL's `stdout` (the AI's "thought process") back to the client, and ultimately return the `FINAL_ANSWER`.

## 4. Success Metrics
The Phase 3 RLM will be considered successful when it can:
1. Receive a query about a contested topic (e.g., "What was the exact acquisition price of Initech?").
2. Write Cypher to hit the `[CONTRADICTS]` edges we built in Epic 4.
3. Write SQL/Python to fetch the conflicting AST spatial text from Postgres.
4. Call a sub-LLM to evaluate the physical text.
5. Return a synthesized, accurate final answer citing the correct spatial hashes.
