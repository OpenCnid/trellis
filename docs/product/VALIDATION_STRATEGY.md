# Trellis Validation Strategy: From Theory to Scale

Before we write tens of thousands of lines of code or spend significant capital on LLM API calls and database infrastructure, Trellis must pass a rigorous, evidence-based validation pipeline. 

Borrowing from modern Machine Learning research and elite software engineering principles, we are shifting our approach from **"build and pray"** to **"predict and scale."** 

This document outlines the orderly, tiered implementation plan to validate the Trellis architecture.

---

## Phase 1: Micro-Empirical Validation (The "Does it work at all?" Phase)

Before attempting to parse complex, real-world enterprise data, we must prove the core mathematics and logic of Trellis in a vacuum.

### 1. "Overfitting the Single Batch" (The Core Sanity Check)
In ML, models are tested to see if they can perfectly memorize a single batch of data. For Trellis, our "single batch" is a tiny, perfectly structured Markdown file (e.g., 1 Heading, 1 Paragraph, 1 List Item).
* **The Test:** We must prove that our Merkle-tree algorithm hashes these three nodes deterministically. We then pass these nodes to the LLM. The LLM must return a 100% perfect `zod` validated schema with zero hallucinations. 
* **The Rule:** If Trellis cannot perfectly parse, hash, and extract a 3-node document, the core theory is flawed. We do not move forward until this error rate is zero.

### 2. The $O(1)$ Cache Invalidation Test
* **The Test:** Parse a 10-paragraph Markdown file and generate the AST hashes. Then, edit a single word in Paragraph 5 and re-parse.
* **The Rule:** The system must mathematically prove that the hashes for Paragraphs 1-4 and 6-10 remain strictly identical, and that only Paragraph 5 and the Document Root hashes change. If a single unedited sibling node changes its hash, the core mathematical invariant is broken and must be fixed.

### 3. Synthetic Algorithmic Data
We will not test early builds on messy PDFs or sprawling legal contracts. Instead, we will generate synthetic, perfectly controlled data to isolate the engine's theoretical capabilities.
* **The Test:** We will write a script to generate hundreds of synthetic markdown logic puzzles (e.g., `Node 1: Company A owns B. Node 2: Company B owns C.`). 
* **The Rule:** By testing Trellis against synthetic data where the answers are mathematically known, we isolate our semantic graph's retrieval capabilities from the noise of messy real-world parsing.

---

## Phase 2: Software Engineering Validation (The "Can we build it?" Phase)

We will separate the *theory* of Trellis from the *design* of Trellis using strict structural validation.

### 1. Proof of Concept (PoC)
We will build a raw PoC to test technical feasibility only.
* **The Scope:** No UI, no BullMQ, no Neo4j, no Zod. A bare-bones Node.js script that reads a markdown file, parses the AST, executes a single synchronous LLM call, and `console.log`s the JSON graph. 
* **The Goal:** Prove that the AST Node IDs can successfully map to the LLM's semantic output.

### 2. The Prototype
Once the PoC proves the math, we build the prototype to test data flow and architecture.
* **The Scope:** Introduce `bullmq` for asynchronous job handling, `zod` for strict boundary validation, and a local instance of `Neo4j` for state. This tests how the system handles queue backpressure and database insertions.

### 3. Asynchronous Chaos Testing
* **The Test:** During the Prototype phase, spin up the `bullmq` Extraction Queue and flood it with 500 mock AST nodes. Force the mock LLM API to randomly fail 20% of the time (simulating `503 Rate Limits`) and return malformed schemas 10% of the time.
* **The Rule:** `zod` must catch 100% of the bad schemas, and `bullmq` must successfully execute exponential backoffs. The system must eventually reach 100% successful ingestion with zero duplicated graph nodes and zero crashed orchestrators.

### 4. Ablation Studies for Advanced Features
As we scale Trellis and introduce groundbreaking features (like HNSW vector overlays or GNN link predictions), we will conduct ablation studies.
* **The Rule:** If we add Hybrid Vector Search, we must test the system's retrieval accuracy *with* and *without* it. If disabling the vector search does not significantly degrade performance, the feature is discarded. We only keep components that mathematically prove their worth.
* **The Positive-Control Duty:** an ablation's null — *"disabling it did not degrade performance"* — is only a finding once a **positive control has fired**. Before trusting it, build a condition where performance *demonstrably* degrades and confirm the test detects it; a control that never discriminates means the test was blind, so the result is noise, not a null. Report **"no detectable effect," never "validated."** (The house "Session 28 lesson"; see `docs/architecture/TEST_TIME_TRAINING.md` §6 and the `self-play` skill's disciplines.)

---

## Phase 3: The Science of Scaling Laws (The "Will it work at scale?" Phase)

Before we deploy Trellis to ingest millions of enterprise documents, we must mathematically guarantee its performance and cost using Scaling Laws.

### Iso-Node Profiling & The Log-Log Curve
We will create 5 to 10 miniature environments to predict exact costs and latency at scale.
* **The Test:** We will run Trellis ingestion on datasets of strictly increasing sizes: 10 nodes, 100 nodes, 1,000 nodes, and 10,000 nodes.
* **The Metrics:** We will measure LLM API cost, token consumption, Queue insertion latency, and GraphDB memory usage.
* **The Extrapolation:** By plotting these metrics on a logarithmic graph against the node count, we will generate a straight-line scaling curve.

### Topological Graph Density Extrapolation
* **The Test:** Measure the ratio of **Tokens per AST Node** to **Entities/Edges Generated**. 
* **The Extrapolation:** Project the memory footprint and Cypher query traversal latency for a 1-million node corpus based on this ratio. If the LLM prompt is generating too dense of a graph (e.g., extracting "is", "has", "was" as useless relationships), the prompt must be ruthlessly pruned before scaling to production.

### The Mathematical Guarantee
By analyzing the slope of this scaling curve, we can mathematically predict *exactly* how much it will cost and how much compute infrastructure (Redis size, DB RAM) is required to ingest a 1-million node corpus—before we ever actually do it. 

If the scaling curve shows exponential latency or infinite cost trajectories, we stop and refactor the architecture.

---

## Summary of Implementation Order

1. **Execute the "Single Batch" test** (Ensure 100% deterministic Merkle math on 3 nodes).
2. **Execute the $O(1)$ Shift validation** (Prove partial updates work).
3. **Write the PoC script** (Test strict LLM schema extraction mapping to those hashes).
4. **Run Synthetic Logic Tests** (Prove the semantic graph can answer queries).
5. **Scaffold the Prototype** (Introduce Queues, Zod, DBs, and Chaos Testing).
6. **Execute Iso-Node Profiling** (Plot the scaling laws for latency, cost, and graph bloat).
7. **Execute at Scale** (Full production ingestion).
