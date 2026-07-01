# Trellis Architecture

This document describes the high-level architecture of Trellis (formerly Syntaxiom).
If you want to familiarize yourself with the codebase, you are just in the right place!

## Bird's Eye View

On the highest level, Trellis is a pipeline that accepts unstructured source documents (PDFs, Markdown) and produces a deterministically synchronized semantic model of the knowledge within them.

Unlike standard RAG and lossy GraphRAG implementations, Trellis preserves the physical geometry of the document using an Abstract Syntax Tree (AST) with Spatial Bounding Boxes, and maps extracted knowledge (Entities/Actions) directly to the Merkle-hashed AST Node IDs, solving the Shift Problem (dynamic updating). We also incorporate a pgvector hybrid fallback for robust retrieval.

## Architecture Invariants

An architecture invariant is a rule about the codebase that must never be broken.

**Architecture Invariant 1: The AST is structurally immutable and content-addressed.**
We never use string indexing, character offsets, or line numbers to locate text. The AST is a Merkle tree. A node's ID is derived solely from the hash of its content and its children.

**Architecture Invariant 2: The Semantic Graph is decoupled from the Document.**
The Knowledge Graph (Entities and Actions) knows absolutely nothing about how a document is parsed. It only knows that knowledge was found at a specific `AST Node ID`. If we change the parsing algorithm, the Knowledge Graph does not break as long as the content hashes remain consistent.

**Architecture Invariant 3: Validation strictly at the boundary.**
We never pass raw strings from LLMs or environment variables deeper into the system. All LLM responses must be coerced into native Structured Outputs and validated via `zod`. All environment variables are validated on boot. 

## Code Map

### `src/core/ast`
The physical structure parser. This takes raw text and converts it into a Merkle-tree hashed AST.
* **Invariant:** This module never calls an LLM. It only parses syntax.

### `src/core/graph`
The semantic interface. This defines the shapes of Entities, Actions, and Edges. 
* **Invariant:** This module knows nothing about Markdown or PDFs. It only references `ASTNode.id`.

### `src/workers`
The asynchronous extraction engine. These workers read `ASTNode` payloads, communicate with LLMs (acting as Archivists), and return extracted Graph data.
* **Invariant:** Workers are stateless. If a worker crashes, the orchestrator simply retries the job.

### `src/config`
Environment and boot-time configuration, strictly validated by `zod`.

## The Active Reasoning Layer (Phase 3 RLM)

While Trellis uses **Node.js, Zod, and BullMQ** to strictly and deterministically *ingest* data, it uses a **Python-based Recursive Language Model (RLM)** for retrieval and reasoning.

Instead of standard JSON tool-calling, Trellis provides the LLM with a sandboxed Python REPL (via the `rlms` pip package). 

### The Execution Boundary
1. **Express API:** Receives user request, returns an SSE stream.
2. **BullMQ Worker:** Picks up the job, uses `child_process.spawn()` to boot the Python RLM environment.
3. **Python REPL:** The LLM writes and executes dynamic Python scripts to traverse the Neo4j graph and fetch Postgres AST text, evaluating evidence via recursive sub-calls. The `stdout` is piped back to Node.js and streamed to the user.

### Architecture Invariant 4: The REPL Sandbox is STRICTLY Read-Only
To protect the mathematical integrity of the Spatial Engine, the RLM operates under strict security boundaries:
1. **No Destructive Cypher:** The `TrellisNeo4j` python wrapper explicitly blocks `CREATE`, `MERGE`, `DELETE`, `SET`, or `DROP` commands during standard reasoning loops. The RLM is a navigator, not a builder.
2. **The Flywheel Exception:** The only allowed mutation is through a highly specific, whitelisted tool: `write_derived_insight(subject, verb, object, sourceNodeIds)`. If the RLM deduces a new fact, it may write a `[DERIVED_INSIGHT]` edge back to the graph, provided it strictly passes the original spatial provenance hashes that led to the deduction.
