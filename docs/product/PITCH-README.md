# Trellis

**Deterministic GraphRAG for Spatial Knowledge Retrieval**

## The Core Thesis: Vectors Hallucinate Geometry
For the past two years, the industry has tried to solve enterprise search by treating documents as amorphous bags of words and throwing them into Vector Databases (Standard RAG). While vectors are excellent for fuzzy semantic matching, they fail at structural reasoning, relational multi-hop queries, and absolute provenance.

Recent research (most notably **Microsoft’s GraphRAG paper on ArXiv**) has conclusively proven that mapping text into a **Knowledge Graph (Entities & Relationships)** vastly outperforms standard dense vector retrieval for global understanding and complex reasoning. Furthermore, Stanford's recent **RAPTOR** paper demonstrated that hierarchical, tree-based retrieval drastically improves performance over flat chunking.

However, current GraphRAG implementations have a fatal flaw: **The Static Update Problem**. They extract the knowledge but discard the physical geometry of the document. If a single paragraph in a 10,000-page manual changes, current systems require massive, expensive re-indexing.

**Trellis solves this.** We do not just extract semantics; we rigorously map the spatial geometry of the document, creating an unbreakable framework for knowledge to grow on.

---

## The Computer Science Behind Trellis

Trellis borrows battle-tested paradigms from compiler design and distributed systems to bridge the gap between chaotic LLM intelligence and deterministic state management. 

### 1. The Immutable Document AST (The Structure)
When unstructured data enters Trellis, a deterministic parser converts it into an **Abstract Syntax Tree (AST)**. This draws directly from the philosophy of **Tree-sitter** (the incremental parsing system used by modern code editors), which proved you can instantly re-parse complex documents in real-time by only updating the nodes that changed.
* **The Math (Content-Addressed Storage):** We apply the exact same mathematical foundation that powers **Git and IPFS**: **Merkle-tree hashing**. Every AST node generates a deterministic SHA-256 hash based on its text content and the hashes of its children. 

### 2. The Semantic Knowledge Graph (The Meaning)
We deploy an asynchronous event-driven pipeline of LLM "Archivist" workers. These workers process the AST nodes and output strictly validated schemas (via native Structured Outputs) to extract **Entities** (Concepts, People, Clauses) and **Actions** (Rules, Relationships).

### 3. The Bridge (Solving the Shift Problem)
The Entities and Actions in our Knowledge Graph do not point to raw text chunks. **They point directly to the Immutable AST Node IDs.**

If a user edits a single sentence, only that specific AST Node's hash changes. Our engine detects this in `O(1)` time, triggers an extraction worker for *only that specific node*, and instantly updates the graph. We achieve perfectly synchronized, real-time GraphRAG updates.

---

## Future Algorithm Integrations (The Roadmap)

To make Trellis the ultimate enterprise AI engine, the architecture natively supports the integration of advanced computer science algorithms:

1. **CRDTs (Conflict-free Replicated Data Types):** By implementing CRDTs into our AST state management, Trellis will allow multiple enterprise users to collaboratively edit the source document in real-time (like Google Docs) while the LLM extraction workers update the knowledge graph concurrently, without ever causing race conditions or locking the document.
2. **Graph Neural Networks (GNNs):** Once our deterministic graph is built, we can overlay GNNs to perform advanced link prediction. If the rigid graph proves that *Company A* relies on *Supplier B*, and *Supplier B* is in *Region C*, a GNN can probabilistically infer supply chain risks without relying on naive vector similarity.
3. **HNSW (Hierarchical Navigable Small World) Hybrid Overlays:** By embedding the semantic nodes themselves into an HNSW index, Trellis can execute true hybrid queries: filtering strictly by AST geometry, traversing via deterministic graph edges, and finding conceptually similar nodes via vector proximity simultaneously.

---

## The Product & UX Vision: Solving for Trust

For enterprise AI, the ultimate UX hurdle is **Trust**. Users do not trust LLMs because LLMs hallucinate citations. 

Because Trellis binds semantic knowledge directly to spatial AST nodes, we can build user interfaces that have been impossible until now:
* **Absolute Provenance UI:** When a user asks a complex multi-hop question, the UI visualizes the exact graph traversal and instantly highlights the precise spatial location of the source document in a split-pane viewer. Zero latency, zero hallucinated citations.
* **Interactive Topological Maps:** Users can visually explore a document not by scrolling, but by navigating its semantic topology. Clicking an Entity in the sidebar highlights everywhere it exists in the document's AST geometry.

## Summary
Trellis takes the proven semantic superiority of GraphRAG and fortifies it with the deterministic rigor of Merkle-trees, Incremental AST Parsing, and future CRDT integrations. It is the definitive bridge between chaotic LLM intelligence and the absolute spatial precision required for next-generation AI interfaces.
