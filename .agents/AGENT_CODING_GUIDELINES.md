# Trellis AI Coding Guidelines

> **ATTENTION AI AGENTS:** If you are an AI coding assistant (Cursor, Copilot, Antigravity, etc.) generating or modifying code in this workspace, you MUST strictly adhere to the following architectural invariants. Failure to do so will compromise the deterministic integrity of the system.

## 1. NEVER Mutate the AST
The Abstract Syntax Tree is an immutable Merkle tree. 
* Do NOT write functions that mutate an `ASTNode` in place.
* Do NOT attempt to track text using character offsets, string indices, or line numbers. 
* The identity of a node is completely bound to its SHA-256 hash (`ASTNode.id`). If a node changes, you must generate a completely new node with a newly calculated hash.

## 2. Strict Boundary Validation
* Do NOT use `JSON.parse()` on raw LLM outputs. You must use native Structured Outputs via the provider's SDK, combined with `zod.parse()` or `zod.safeParse()`.
* Do NOT pass raw `process.env` variables deeply into the application. Use the schema-validated config object exported from `src/config/index.ts`.

## 3. State Decoupling
* Do NOT put semantic knowledge (Entities, Actions, Summaries) inside the `ASTNode` interface. 
* The `ASTNode` is strictly for physical document geometry. Semantic knowledge belongs in the Graph Database, referencing the `ASTNode.id`.

## 4. Asynchronous Resilience
* Do NOT write blocking or synchronous `for` loops that iterate over an entire document to call the LLM API. 
* All LLM calls MUST be executed within a `bullmq` worker context to ensure they can fail, backoff, and retry independently.

## 5. Defensive Error Handling

* Do NOT use naive substring matching to classify errors (e.g., `error.message.includes('403')`).
* Inspect actual HTTP status codes and API-specific error types. Assume the LLM API will frequently timeout or return `502 Bad Gateway`. Handle this gracefully via the job queue.
