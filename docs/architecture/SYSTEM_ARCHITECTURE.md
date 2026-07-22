# Trellis System Architecture

> **Status: historical (Phase 1 MVP era).** Preserved as the record of
> the original system design. The maintained architectural orientation is
> `docs/ORIENTATION.md`; the system-level framing is
> `docs/operations/OPERATOR_MANUAL.md`. Where this document and current code disagree,
> the code and the living records win.

This document outlines the macro-level system design and execution environment required to run Trellis at scale.

## Orchestration & Runtime
Trellis is orchestrated as an event-driven distributed system designed to handle the high latency and unreliability inherent to LLM APIs.

* **Language**: TypeScript / Node.js
* **Rationale**: Strong type-safety via `zod` for API boundaries, with a highly robust asynchronous event loop suited for orchestrating thousands of parallel network requests to LLM providers.

## The Three-Tier Database Model

To handle the decoupling of physical structure and semantic meaning, Trellis utilizes three distinct data stores:

### 1. Document Store (The AST)
* **Technology**: NoSQL Document Store (e.g., MongoDB, DynamoDB) or Blob Storage.
* **Role**: Stores the massive, heavily nested JSON representations of the Immutable Document ASTs. Keyed by the `ASTNode ID` (the Merkle hash).

### 2. Semantic Knowledge Graph
* **Technology**: Graph Database (e.g., Neo4j, Memgraph).
* **Role**: Stores the Entities and Actions extracted by the LLMs. Supports complex Cypher queries for multi-hop relational reasoning. Entities contain edges pointing back to the `ASTNode ID` in the Document Store.

### 3. Vector Hybrid Index (Optional but Recommended)
* **Technology**: Vector Database (e.g., Pinecone, Qdrant).
* **Role**: Stores standard dense embeddings of the AST nodes and/or Graph Entities. Enables fallback "fuzzy" semantic search (HNSW) to complement the rigid graph traversal.

## The Event-Driven Pipeline

Because LLM extraction can take seconds (or fail due to rate limits), ingestion cannot be synchronous.

1. **Ingestion API**: Receives a raw document and pushes it to the `Parsing Queue`.
2. **Parsing Workers**: Pop jobs off the queue, run the AST generation, save the AST to the Document Store, and fan out the individual AST Nodes to the `Extraction Queue`.
3. **Archivist Workers**: Pop AST Nodes off the extraction queue. They call the LLM API using strict Structured Outputs, map the response to Graph schemas, and write to the Graph Database.
4. **RLM Workers**: Pop jobs off the `rlm_queue`. They spawn a sandboxed Python REPL agent injected with deterministic database tools (`TrellisNeo4j`, `TrellisPostgres`) to traverse the knowledge graph and vector layer, streaming thought-process stdout via Redis PubSub back to the frontend.

## Error Handling & Resiliency
* **LLM Failures**: If an LLM returns a malformed schema, the worker throws a validation error and the message is returned to the queue with an exponential backoff.
* **Partial Updates**: Because AST Nodes are content-hashed, if an ingestion job fails halfway through, the system can safely retry. The Merkle hashing ensures idempotency—we will never extract duplicate knowledge for the exact same hash.

## Observability & Telemetry (The Measurement Layer)
To successfully validate the system (especially during Iso-Node Profiling and scaling extrapolations), we cannot rely on primitive logging. The architecture mandates two layers of observability:
* **LLM Telemetry (e.g., LangSmith, Helicone, or Braintrust):** Every API call made by an Archivist worker is routed through an LLM observability platform. This tracks the precise token count, inference latency, and exact cost per AST Node, allowing us to mathematically monitor "Topological Graph Bloat" and plot accurate scaling curves.
* **Queue Telemetry (e.g., OpenTelemetry, Datadog):** Standard APM tools monitor the `bullmq` orchestrator to measure queue backpressure, worker crash rates, and exponential backoff success rates during chaos testing.

## Enterprise Security & Privacy (The Trust Factor)
Trellis is built for Enterprise Knowledge Workers (Lawyers, Researchers) where data security is an existential requirement.
* **Zero Data Retention (ZDR):** Trellis strictly utilizes enterprise-grade API endpoints (such as Azure OpenAI or OpenAI Enterprise) configured with explicit Zero Data Retention agreements.
* **The Privacy Promise:** No chunk of an enterprise document's AST is ever logged, cached, or used by the LLM provider to train their foundational models. The pipeline is completely stateless at the LLM extraction boundary.
