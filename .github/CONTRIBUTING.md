# Contributing to Trellis Engine

Welcome to the Trellis Engine. This project relies on extremely strict, non-traditional architectural invariants. 
To avoid corrupting the determinism of the pipeline, all contributors must adhere to the following rules.

> Working with a coding agent, CLI, or harness? Its entry point is
> [`AGENTS.md`](../AGENTS.md) at the repository root — the project basis, the
> annotated file tree, and the index that fans out to [`AMBIENT.md`](../AMBIENT.md),
> which binds every session, and to [`.claude/rules/`](../.claude/rules/), one file
> per kind of work (they include and extend the rules below). The collaborator's
> live task supplies the current objective; `HANDOFF.md` is a deprecated
> compatibility stub.

## 1. Modifying Graph Schemas
The Trellis LLM extraction pipeline enforces structure using strictly typed JSON (via Zod). 
If you need to add a new property to an Entity or Action:
1. **You MUST update `src/core/graph/schemas.ts` first.**
2. This ensures the LLM's Structured Output generation and our downstream parsing are perfectly aligned. 
3. *Never* parse raw text or JSON without running it through the Zod schema validation.

## 2. The Golden Rule of the AST
The Physical Layer is defined by the Merkle-tree hashing algorithm. 
- AST Node IDs are mathematically derived from their content and their children.
- **NEVER manually manipulate, auto-increment, or override an AST Node ID.**
- The ID is the absolute, cryptographically secure coordinate of that specific piece of text. If you alter the text without recalculating the SHA-256 hash, the provenance bridge will collapse.

## 3. Distributed Identity & Queue Discipline
Trellis scales by distributing paragraph extraction across parallel `bullmq` workers. 
- **Global Deterministic IDs:** LLMs will hallucinate local identifiers (e.g., `e1`, `e2`) during extraction. These are useless across a distributed queue. The extraction worker currently converts these local IDs into a global SHA-256 hash of the normalized entity name before touching the database. Do not revert to using the LLM's ID directly.
- **Adding New Workers:** If you add a new BullMQ queue/worker (e.g., for generating vector embeddings or summarizing nodes), ensure that it gracefully handles `UPSERT` / `MERGE` operations. Do not assume synchronous execution.

## 4. Database Invariants
- **PostgreSQL:** Used exclusively for immutable Document/AST storage. Do not build relational logic here.
- **Neo4j:** Used exclusively for semantic relationships. 

Always respect the boundaries of the dual-layer architecture.
