# Trellis Engine: OOLONG Benchmark Specification

## 1. Overview
To mathematically prove that the **Trellis Engine** (Deterministic Spatial Reasoning) represents a generational leap over standard Recursive Language Models (RLMs), we are executing an apples-to-apples benchmark against the MIT CSAIL RLM paper (Zhang et al., 2026). 

We will use the **OOLONG-Pairs** dataset (`oolongbench/oolong-synth`, `trec_coarse` split), which the MIT researchers identified as a quadratic-scaling ($O(N^2)$) information-dense task.

## 2. The "Spatial Flywheel" Hypothesis
**The MIT Baseline:** The standard RLM loads the entire dataset into a Python REPL and writes scripts with thousands of sub-LLM calls to semantically classify text. It is ephemeral. Query 1 costs ~$1.12. Query 2 costs ~$1.12. It scales linearly in cost and time per query.
**The Trellis Advantage:** Trellis maps data to a graph. For Query 1, the Trellis RLM will classify the text but use its `write_derived_insight` tool to cache those semantic labels into Neo4j. For Queries 2-20, the RLM will skip expensive sub-LLM text evaluation and simply write Cypher queries to fetch the cached classifications.
**The Goal:** We expect Query 1 to match the MIT RLM in cost/latency, but Queries 2-20 will drop to near-zero cost ($O(1)$ amortized reasoning) while maintaining or beating the MIT F1 score.

## 3. Architecture & Implementation Steps

The benchmarking suite requires three distinct components:

### A. The Ingestion Pipeline (`scripts/benchmarks/fetch_oolong.py`)
A Python script to pull the ground-truth data and pipe it into Trellis.
* **Source:** Hugging Face `datasets` library (`load_dataset("oolongbench/oolong-synth", split="trec_coarse")`).
* **Formatting:** Convert the dataset rows into deterministic Trellis input (e.g., Markdown blocks mapping User IDs to text questions).
* **Ingestion:** POST the formatted text to the Trellis `/ingest` endpoint to generate the Postgres AST and foundational Neo4j graph.

### B. The RLM Flywheel Upgrade (`src/rlm/trellis_agent.py`)
The `SYSTEM_PROMPT` of our Python RLM agent must be strictly upgraded to enforce Flywheel caching.
* **Directive:** *"When asked to semantically classify a User ID or Question, you MUST check the Neo4j graph first. If the classification does not exist, use `llm_query()` to evaluate the Postgres AST text, and IMMEDIATELY use `neo4j.write_derived_insight(userId, 'HAS_CATEGORY', categoryLabel, [astHash])` to permanently save your classification to the graph. Do not process pairs until all necessary individual entities are classified and saved in Neo4j."*

### C. The Evaluation Engine (`src/benchmarks/oolong_runner.ts`)
A Node.js test runner that loops through the 20 OOLONG-Pairs queries, triggering the `/api/rlm-stream` endpoint.
* **Parsing:** Extract the outputted tuple pairs (e.g., `(22740, 35839)`) from the RLM's `FINAL_ANSWER`.
* **Scoring:** Implement an F1-Score calculator comparing the RLM's outputted pairs against the HF ground-truth labels (Precision, Recall, and F1).
* **Telemetry:** For each of the 20 queries, the runner MUST log:
  1. **F1 Score** (Accuracy metric)
  2. **Total Tokens** (Prompt + Completion)
  3. **Sub-call Count** (Number of `llm_query` invocations inside the REPL)
  4. **Cost** (Estimated USD based on `gpt-5.4-mini` or `gpt-4o` token pricing)

## 4. Success Criteria
The benchmark is successful if the telemetry output demonstrates a drastic dropoff in **Sub-call Count** and **Cost** between Query 1 and Query 20, proving the Trellis Semantic Graph successfully absorbed and reused the RLM's recursive reasoning.
