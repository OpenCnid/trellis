# Trellis Technical Specification (MVP)

This document provides the concrete engineering specifications required to build the Trellis MVP.

## 1. Tech Stack
* **Language**: TypeScript (Node.js)
* **Parser**: `mdast` / `unified`
* **Queue**: `bullmq` (Redis)
* **Validation**: `zod`
* **Graph DB**: `neo4j-driver`
* **LLM SDK**: Native SDKs supporting Structured Outputs (`@google/genai` or `openai`).

## 2. Core Data Schemas

### Document AST
```typescript
interface ASTNode {
  id: string; // SHA-256 Hash of (type + text + children IDs)
  type: 'document' | 'heading' | 'paragraph' | 'list' | 'listItem';
  text?: string;
  children?: ASTNode[];
}
```

### Knowledge Graph
```typescript
interface Entity {
  id: string; // UUID
  name: string;
  type: string;
  sourceNodeIds: string[]; // Foreign keys to ASTNode.id
}

interface Action {
  id: string; // UUID
  subjectId: string; // Foreign key to Entity.id
  verb: string;
  objectId: string; // Foreign key to Entity.id
  sourceNodeIds: string[]; // Foreign keys to ASTNode.id
}
```

## 3. Worker Queue Architecture
* **Queue Definition**: A Redis-backed `bullmq` instance named `ExtractionQueue`.
* **Job Payload**: `{ astNodeId: string, text: string }`.
* **Concurrency**: Set worker concurrency to `5` to avoid hitting LLM API rate limits.
* **Retry Strategy**: Exponential backoff. Max 3 retries.

## 4. Implementation Steps
1. **Build the Parser (`src/core/ast`)**: Implement the function that converts a Markdown string into the `ASTNode` Merkle-tree structure.
2. **Setup the DBs**: Initialize Neo4j and a simple document store (or Postgres JSONB) for the AST.
3. **Build the Queue**: Implement the `ExtractionQueue` producer (pushes nodes) and consumer (calls the LLM).
4. **LLM Integration**: Implement the `zod` schema enforcement for the LLM extraction prompt.
5. **Bridge Logic**: Ensure that upon successful extraction, the Worker creates the nodes/edges in Neo4j and attaches the `sourceNodeIds`.
