# Phase 3 PRD: The Trellis RLM Harness

## 1. Product Vision
Trellis is currently a passive **Deterministic Spatial Reasoning Engine**. In Phase 3, we are evolving it into an **Active Autonomous System**. 

Standard "Agentic Search" (grep loops) blindly retrieves text, thrashes the LLM's context window, and fails at multi-hop reasoning. We are replacing passive retrieval with a **Recursive Language Model (RLM)** harness based on research from MIT CSAIL. By giving the LLM a secure Python REPL (Read-Eval-Print Loop), the AI will autonomously write code to navigate our Neo4j graph, evaluate spatial AST text from PostgreSQL, execute sub-LLM calls, and loop until it deduces a definitive answer.

## 2. Architectural Shift (The 3 Changes)
We are abandoning restrictive JSON tool-calling (OpenAI Functions) and transitioning to native code execution.

* **Change 1: The Official Python Library:** We will use the official MIT library (`pip install rlms`) to instantiate the RLM and REPL sandbox.
* **Change 2: Native Database Drivers:** Instead of JSON tools, we will build Python wrapper classes (`TrellisNeo4j` and `TrellisPostgres`) and inject them directly into the Python REPL via the `custom_tools` parameter.
* **Change 3: BullMQ Orchestration Shift:** The Node.js backend remains the traffic cop. Express handles the HTTP request, pushes a job to BullMQ, and the Node.js worker spawns the Python agent via `child_process`, streaming the `stdout` back to the user.

## 3. Milestones

### Milestone 1: Python Database Wrappers (`src/rlm/trellis_tools.py`)
Build Python-native interfaces that expose our databases safely to the REPL.
* **`TrellisNeo4j`:** Exposes `run_cypher(query)` to navigate the semantic graph.
* **`TrellisPostgres`:** Exposes `get_ast_texts(hashes)` and `vector_search(query)` for physical and hybrid semantic lookup.

### Milestone 2: The RLM Agent (`src/rlm/trellis_agent.py`)
Instantiate the RLM using the `rlms` library.
* Inject `TrellisNeo4j` and `TrellisPostgres` as `custom_tools`.
* The LLM writes native Python to fetch data and uses `llm_query()` to evaluate it without polluting its main context window.

### Milestone 3: Node.js Orchestration (`src/api/server.ts` & `src/workers/rlm_worker.ts`)
* **`GET /api/rlm-stream`:** A new SSE (Server-Sent Events) endpoint.
* A new BullMQ worker that spawns `python src/rlm/trellis_agent.py`, captures the terminal output in real-time, and streams the AI's "thought process" back to the client.

## 4. Success Metrics
The Phase 3 RLM will be considered successful when it can receive a complex query, write Python code to hit a `[CONTRADICTS]` edge, fetch the conflicting AST spatial text from Postgres, evaluate it with a sub-LLM, and return a synthesized final answer.
