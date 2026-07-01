# OOLONG-Pairs Benchmark Operational Guide

This document defines the operational specifications for running the OOLONG-Pairs benchmark on the Trellis Engine. 

---

## 1. OOLONG-Pairs Concepts

The **OOLONG-Pairs** benchmark evaluates long-context reasoning and pairwise information aggregation in language models.

### I. The Quadratic Complexity Problem ($O(n^2)$)
Traditional LLMs utilize a "flat context" architecture where the entire source document is fed directly into the context window. While this suffices for simple "needle-in-a-haystack" retrieval tasks, it fails catastrophically on dense, multi-hop aggregation tasks:
*   **Linear Aggregation (OOLONG):** Requires processing almost all $n$ entries in the context to compute a global summary (e.g., counting labels). The reasoning complexity scales linearly $O(n)$.
*   **Pairwise Aggregation (OOLONG-Pairs):** Requires cross-referencing statements scattered across the entire text to identify relationships between pairs of entities that satisfy a complex logical filter. Because any entry can pair with any other entry, the search space scales quadratically:
    $$\text{Search Space} \propto \frac{n(n - 1)}{2} = O(n^2)$$
As the context size grows (from 8k to 128k+ tokens), standard frontier models experience severe performance degradation ("context rot"), with accuracy dropping to near 0%.

### II. TREC Coarse Dataset Structure
OOLONG-Pairs utilizes the **TREC Coarse-Grained classification corpus** as its underlying data. The corpus consists of thousands of question entries, each belonging to one of six coarse categories:
1.  `ABBR` (Abbreviation)
2.  `ENTY` (Entity)
3.  `DESC` (Description)
4.  `HUM` (Human)
5.  `LOC` (Location)
6.  `NUM` (Numeric)

A typical OOLONG-Pairs task asks: *"Identify all pairs of LOC and HUM questions that mention the same city."* Solving this requires the model to correctly classify each query, identify the target entity (the city), and compute the intersecting pairs across the entire dataset.

---

## 2. The Database Mapping

Trellis translates this quadratic reasoning problem into structured database operations by dividing the data into physical and semantic layers linked by cryptographic hashes.

```
                  Raw Input Text (TREC Entries)
                               │
                               ▼
                    [Trellis Ingestion]
                     /             \
                    /               \
       Physical AST Layer        Semantic Graph Layer
       (PostgreSQL Store)         (Neo4j Graph Store)
       ┌────────────────┐        ┌──────────────────┐
       │   ast_nodes    │        │  (:Question)     │
       ├────────────────┤        │  - category      │
       │ id (SHA-256)   │◄───────┼──sourceNodeIds   │
       │ data (content) │        └────────┬─────────┘
       └────────────────┘                 │
                                          │ [REFERENCES]
                                          ▼
                                 ┌──────────────────┐
                                 │   (:Concept)     │
                                 │  - name          │
                                 └──────────────────┘
```

### I. The Physical Layer (PostgreSQL)
The input corpus is parsed into a flat sequence of child nodes under a root document node using our Markdown parser.
*   **Table:** `ast_nodes`
*   **Hashing Rule:** We always use the official parser (`src/core/ast/parser.ts`) to compute hashes recursively. Under the hood, for leaf text nodes:
    $$\text{ID}(N_{\text{leaf}}) = \text{SHA256}(\text{Type}(N_{\text{leaf}}) + \text{":"} + \text{Content}(N_{\text{leaf}}))$$
    For parent block nodes (like paragraph or heading blocks folding child nodes):
    $$\text{ID}(N_{\text{parent}}) = \text{SHA256}(\text{Type}(N_{\text{parent}}) + \text{":"} + \sum \text{ID}(\text{Child}_i))$$
*   **Record Structure:**
    ```json
    {
      "id": "a1f9c3...",
      "document_id": "root_doc_hash...",
      "data": {
        "type": "paragraph",
        "content": "What is the capital of France?"
      }
    }
    ```

### II. The Semantic Layer (Neo4j)
During extraction, semantic entities are mapped to nodes, and their source origin is preserved.
*   **Question Node:**
    *   **Label:** `:Question`
    *   **Properties:** `id` (e.g. `"q_104"`), `text`, `category` (e.g. `"LOC"`), `sourceNodeIds` (array containing the corresponding physical `ASTNode.id` hash).
*   **Concept Node:**
    *   **Label:** `:Concept`
    *   **Properties:** `name` (normalized lowercase, e.g. `"paris"`), `sourceNodeIds` (array of origin `ASTNode.id` hashes).
*   **Relational Edge:**
    *   **Type:** `[REFERENCES]`
    *   **Properties:** `sourceNodeIds` (array containing the `ASTNode.id` hash).
    *   **Traversable Path:** `(:Question)-[:REFERENCES]->(:Concept)`

---

## 3. Mathematical Scoring Formulas

The benchmark evaluation grades predictions against ground-truth answers using three distinct mathematical scoring functions:

### I. Set-Based F1-Score (For Pair Lists)
Used when the model must output a list of matching ID pairs. Let $P_{\text{true}}$ be the set of ground-truth pairs and $P_{\text{pred}}$ be the set of predicted pairs.
*   **Precision:** The ratio of correct predicted pairs to all predicted pairs.
    $$\text{Precision} = \frac{|P_{\text{pred}} \cap P_{\text{true}}|}{|P_{\text{pred}}|}$$
*   **Recall:** The ratio of correct predicted pairs to all ground-truth pairs.
    $$\text{Recall} = \frac{|P_{\text{pred}} \cap P_{\text{true}}|}{|P_{\text{true}}|}$$
*   **F1-Score:** The harmonic mean of precision and recall.
    $$\text{F1} = 2 \times \frac{\text{Precision} \times \text{Recall}}{\text{Precision} + \text{Recall}}$$

### II. Exponential Decay Score (For Numeric Counts)
Used when the model is asked to return the total count of valid pairs. The score scales continuously between $0.0$ and $1.0$ based on the absolute error:
$$\text{Score} = 0.75^{|y_{\text{pred}} - y_{\text{true}}|}$$
Where:
*   $y_{\text{pred}}$ is the predicted integer count.
*   $y_{\text{true}}$ is the actual ground-truth count.

### III. Exact Match (For Categorical Labels/Dates)
Used for single-word classification categories or specific date matches.
$$\text{Score} = \begin{cases} 
      1.0 & \text{if } y_{\text{pred}}.\text{toLowerCase}() == y_{\text{true}}.\text{toLowerCase}() \\
      0.0 & \text{otherwise}
   \end{cases}$$
