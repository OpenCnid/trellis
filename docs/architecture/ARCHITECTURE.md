# Trellis Architecture

This document describes the high-level architecture of Trellis (formerly Syntaxiom).
If you want to familiarize yourself with the codebase, you are just in the right place!

## Bird's Eye View

On the highest level, Trellis is a pipeline that accepts unstructured source documents (PDFs, Markdown) and produces a deterministically synchronized semantic model of the knowledge within them.

Unlike standard RAG, Trellis preserves the physical geometry of the document using an Abstract Syntax Tree (AST) and maps extracted knowledge (Entities/Actions) directly to the AST Node IDs, solving the Shift Problem (dynamic updating).

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
