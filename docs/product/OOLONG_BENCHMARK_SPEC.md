# OOLONG-Pairs Benchmark Specification

This specification outlines the loop-based design principles, pipeline architecture, and development backlog for executing the OOLONG-Pairs benchmark on Trellis.

---

## 1. Loop-Based Design Architectures

To ensure structural resilience, both the ingestion and evaluation pipelines are designed as self-correcting loops rather than static, single-pass events.

### I. Ingestion-as-a-Loop
Instead of executing a single, massive import script that is prone to partial failures, ingestion is structured as a transaction-verified micro-batch loop:

```
    [Start Ingestion]
           │
           ▼
┌──────────────────────────────┐
│  Fetch Next Micro-Batch      │◄───────────────────────────┐
└──────────┬───────────────────┘                            │
           │                                                │
           ▼                                                │
┌──────────────────────────────┐                            │
│  Write AST Nodes to Postgres │                            │
└──────────┬───────────────────┘                            │
           │                                                │
           ▼                                                │
┌──────────────────────────────┐                            │
│  Verify Postgres Hash Integrity                           │
│  (Read back & match SHA-256) │                            │
└──────────┬───────────────────┘                            │
           │                                                │
           ├───────────────────────[FAIL] ──► [Log & Retry] ─┤
           │                                                │
           ▼ [PASS]                                         │
┌──────────────────────────────┐                            │
│  Write Entities/Edges Neo4j  │                            │
└──────────┬───────────────────┘                            │
           │                                                │
           ▼                                                │
┌──────────────────────────────┐                            │
│  Verify Mapped Constraints   │                            │
│  (Validate sourceNodeIds)    │                            │
└──────────┬───────────────────┘                            │
           │                                                │
           ├───────────────────────[FAIL] ──► [Log & Retry] ─┘
           │
           ▼ [PASS]
   [Advance Batch]
```

*   **Transactional Verification:** Each micro-batch is written in a PostgreSQL transaction block. The script reads back the written node IDs, verifies that their computed hashes match, and commits.
*   **Graph Validation:** After Neo4j insertion, the loop runs a verification query to verify that every imported `:Question` node successfully references its source AST ID in `sourceNodeIds`.

### II. Evaluation-as-a-Loop (Adversarial Error-Feedback Routing)
During evaluation, the RLM agent writes Python scripts in its REPL. Rather than crashing on query failures, the evaluator feeds runtime errors back to the model:

1.  **Execution Interception:** The orchestrator spawns the RLM agent.
2.  **REPL Exception Capture:** If the agent executes a Cypher or SQL query that throws a database error (e.g., syntax error, invalid relationship label), the Python interpreter catches the exception.
3.  **Feedback Injection:** The caught traceback is formatted and appended to the RLM conversation history as system execution feedback:
    ```
    System Feedback: The previous execution failed.
    Traceback (most recent call last):
      File "<repl>", line 2, in <module>
        trellis_neo4j.run_cypher("MATCH (q:Ques) ...")
      Neo4jError: Node label 'Ques' is invalid. Did you mean 'Question'?
    ```
4.  **Self-Correction Loop:** The RLM agent reviews the traceback, identifies the mistake, rewrites the Cypher/SQL query, and executes again, looping up to the `max_iterations = 5` threshold.

---

## 2. Chunked Task Backlog

The implementation of this benchmark is divided into granular, micro-milestones to ensure code correctness at each step.

### Milestone 1: Ingestion Pipeline
*   **Task 1a: Single Sample Record Parser**
    *   *Input:* A single JSON record from the OOLONG dataset.
    *   *Operation:* Extract the question text, identifier, and classification labels.
    *   *Output:* A raw structured JSON payload.
    *   *Verification:* Print the parsed fields to stdout and check for schema adherence.
*   **Task 1b: Single Record Merkle Hash Verification**
    *   *Input:* Parsed record from Task 1a.
    *   *Operation:* Convert the record into a markdown-formatted string and parse it using `parseMarkdownToAST()` to verify the deterministic SHA-256 hash generation.
    *   *Output:* An AST Node ID.
    *   *Verification:* Assert that running the hash function multiple times yields identical results.
*   **Task 1c: Full Ingestion Verification Loop**
    *   *Input:* The entire OOLONG-Pairs dataset.
    *   *Operation:* Implement the micro-batch loop mapping data to PostgreSQL and Neo4j, checking hash constraints at the end of each batch.
    *   *Output:* Databases populated with verified records.
    *   *Verification:* Verify database connections and run validation SQL/Cypher queries.

### Milestone 2: Evaluation & Scoring Engine
*   **Task 2a: Topological Traversal Query Test**
    *   *Input:* Neo4j database populated in Milestone 1.
    *   *Operation:* Write a Cypher query to retrieve pairs of question nodes that share an edge to the same concept node.
    *   *Output:* A list of matching ID pairs.
    *   *Verification:* Manually cross-check the output list against a tiny subset of known answers to ensure query correctness.
*   **Task 2b: REPL Error-Trapping Feedback Routing**
    *   *Input:* An active RLM REPL session.
    *   *Operation:* Inject an intentionally malformed Cypher query into the REPL, capture the stdout/stderr traceback, and verify it is routed back to the agent conversation log.
    *   *Output:* Error message injected into agent prompt.
    *   *Verification:* Confirm the RLM agent successfully corrects the query and gets a correct response on the next turn.
*   **Task 2c: Metrics and Evaluation Runner**
    *   *Input:* RLM final output answers and dataset ground-truth answers.
    *   *Operation:* Build the scoring module implementing Set F1-score, Exponential Decay, and Exact Match scoring algorithms.
    *   *Output:* A detailed score report file (`docs/benchmarks/artifacts/benchmark_results.json`).
    *   *Verification:* Run unit tests on the scoring function with mock outputs (e.g. perfect match, off-by-one count, partially matching sets).
