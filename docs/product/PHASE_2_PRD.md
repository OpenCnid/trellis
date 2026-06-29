# Phase 2: Product Requirements Document

## Overview
Phase 1 validated the architecture and built the deterministic MVP. Trellis successfully solved the "Shift Problem" and Graph Bloat by tying LLM semantic extraction directly to a Merkle-hashed AST coordinate system.

Phase 2 focuses on making the engine accessible to end-users, expanding its ingestion capabilities, and building robust fallback mechanisms for complex queries.

## Epic 1: The Absolute Provenance UI
**Goal:** Build a frontend interface that visually proves the mathematical guarantees of Trellis.
- **Features:**
  - A React/Next.js split-pane viewer.
  - Left Pane: Interactive Graph Visualization (e.g., using `react-force-graph` or Cytoscape).
  - Right Pane: The actual Document text.
- **Interaction:** When a user clicks a node or an edge in the left pane, the frontend consumes the `GET /retrieve` API and highlights the exact physical AST paragraphs in the right pane concurrently.

## Epic 2: Enterprise Format Ingestion
**Goal:** Move beyond simple Markdown to support complex enterprise documents.
- **Features:**
  - Swap the basic `mdast` parser for an advanced, multi-modal parser (e.g., LlamaParse, Unstructured.io).
  - Ensure that the output of these parsers can still be rigorously hashed into a Merkle-tree to preserve our $O(1)$ immutability and provenance tracking.

## Epic 3: Vector Fallback (HNSW)
**Goal:** Prevent dead-ends when a user searches for an entity that doesn't strictly match the Neo4j ontology.
- **Features:**
  - Add a vector database (e.g., Pinecone or Qdrant) alongside Neo4j and PostgreSQL.
  - During ingestion, embed the text of the leaf nodes and store them in the vector DB, keyed by the identical AST Node ID.
  - **Retrieval Logic:** If a strict Cypher graph traversal returns empty, execute a fuzzy semantic search on the vector DB, retrieve the AST IDs, and feed them back into the graph to find the nearest semantic neighbors.

## Epic 4: Dynamic Graph Merging & Conflict Resolution
**Goal:** Handle contradictory knowledge extracted across diverse document sets.
- **Features:**
  - As the corpus grows, Document A may claim "Revenue is $5M" while Document B claims "Revenue is $6M".
  - Build an LLM Supervisor Worker that routinely scans Neo4j for conflicting properties on identical edges.
  - Instead of overwriting, the supervisor will branch the sub-graph into "Belief States" (e.g., `[Revenue_State_1]` and `[Revenue_State_2]`), perfectly traceable back to their unique AST provenance paths.
