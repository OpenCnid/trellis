# Mathematical Foundations of Trellis

The defining feature of Trellis is that it solves the "Shift Problem" (the catastrophic failure of offsets when a document is edited) using cryptographic mathematics rather than string manipulation. 

This document explains the mathematical and data-structure principles underlying the engine.

## 1. Merkle Trees and Content-Addressed Storage

In a standard retrieval system, a chunk of text is identified by its position: 
`Document 1 -> Paragraph 4 -> Characters 500 to 650`. 
If you insert a word at Character 10, the address of every subsequent chunk is invalidated.

Trellis borrows the mathematical foundation of **Git** and **IPFS**: the Merkle Tree.

### The Hashing Function
Let $N$ be an AST Node. The unique Identifier $ID(N)$ is a cryptographic hash (SHA-256) defined recursively as:

$$ ID(N) = HASH( Type(N) + Content(N) + Metadata(N) + \sum_{i=1}^{k} ID(Child_i) ) $$

Where:
* $Type(N)$ is the structural type (e.g., "heading", "paragraph").
* $Content(N)$ is the raw text belonging exclusively to that node.
* $Metadata(N)$ is the node's canonically serialized structural
  metadata (for PDF nodes: page number and bounding box; empty for
  nodes that carry none).
* The sum represents the concatenated hashes of all $k$ child nodes.

### $O(1)$ Cache Invalidation (The Shift Solution)
Because a node's ID is derived from its content and its children, **an edit to a leaf node changes its hash, which recursively changes the hash of its parents all the way to the root.** 

However, sibling nodes and their subtrees are **mathematically completely unaffected**. 

When a document is edited and re-parsed, Trellis calculates the intersection of the new AST hashes and the existing database hashes. The difference represents the exact, granular nodes that changed. The engine updates the Graph Database for those specific nodes in $O(1)$ relative to the unedited portion of the document, completely bypassing full-scale re-indexing.

## 2. Topological Graph Extraction

The LLM Archivist workers map unstructured text into a directed graph $G = (V, E)$.

* **Vertices ($V$)**: Extracted Entities (e.g., Person, Concept, Clause).
* **Edges ($E$)**: Extracted Actions/Relationships connecting the entities.

Crucially, Trellis enforces a bipartite mapping between the Semantic Graph $G$ and the Document AST $T$:
Let $S(v)$ be the spatial projection function that maps a semantic vertex $v \in V$ to the set of AST nodes where it is manifested. 

$$ S(v) = \{ N_1, N_2, \dots, N_m \} $$

Where every $N \in T$. This projection is what allows the user interface to draw a line from an abstract concept directly to the exact spatial coordinate in the original document, ensuring absolute provenance.

## 3. Future Integration: CRDTs (Conflict-free Replicated Data Types)

To support real-time collaborative editing of the source documents without corrupting the AST, Trellis will integrate Sequence CRDTs (like LSEQ or YATA). 

CRDTs mathematically guarantee that two users editing the same document concurrently will eventually converge on the exact same AST state without requiring a central locking mechanism. Because the AST state is conflict-free, the Merkle hashes remain deterministic, allowing the Archivist workers to extract semantic knowledge safely even while the document is being actively typed by humans.
