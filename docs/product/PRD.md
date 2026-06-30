# Product Requirements Document (PRD): Trellis MVP

## 1. Product Vision
Trellis is a Deterministic Spatial Reasoning Engine. It aims to solve the hallucination and dynamic-update problems of standard RAG and lossy GraphRAG implementations by strictly decoupling a document's physical geometry (AST) from its semantic meaning (Knowledge Graph), preserving spatial bounding boxes and utilizing Merkle-tree hashing. 

## 2. Target Audience
* **Enterprise Knowledge Workers:** Lawyers, researchers, and engineers who need 100% accurate, multi-hop reasoning with absolute citation provenance back to the source text.

## 3. MVP Scope
To prove the core architectural thesis, the MVP will be strictly scoped to the following:
* **Supported Inputs**: Markdown files only (PDF/Word support is post-MVP).
* **AST Generation**: Parse Markdown into a deterministic Merkle-tree AST.
* **Extraction**: Use an asynchronous queue to pass AST nodes to an LLM for Entity/Action extraction.
* **Storage**: Store the AST in PostgreSQL/MongoDB and the semantic graph in Neo4j/Memgraph.
* **Retrieval**: A basic API endpoint that accepts a natural language query and returns the relevant subgraph along with the exact AST Node IDs.

## 4. Out of Scope (Post-MVP)
* Real-time collaborative editing (CRDTs).
* Hybrid Vector/HNSW search (stick strictly to Graph querying for MVP).
* Complex UI/Frontend (API-only for MVP).

## 5. Success Metrics for MVP
* **Zero Offset Drift:** If a Markdown file is edited and re-uploaded, the system must update the graph in `O(1)` relative time without duplicating untouched nodes.
* **100% Schema Adherence:** The LLM extraction workers must gracefully fail and retry if the LLM hallucinates an invalid JSON schema.
* **Latency:** End-to-end ingestion of a 10-page Markdown file must complete in under 60 seconds (accounting for LLM API rate limits).
