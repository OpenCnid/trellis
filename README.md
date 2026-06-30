# Trellis Engine

Trellis is a Deterministic Spatial Reasoning Engine designed for enterprise knowledge. Standard GraphRAG (like Microsoft's implementation) extracts semantic entities but destroys the physical geometry of the source document, causing it to break when documents are updated. Trellis solves this by replacing standard, lossy GraphRAG with a mathematically rigorous architecture that maps the amorphous reasoning of Large Language Models directly to an immutable, Merkle-hashed coordinate system.

## Overview
1. **The Physical Layer (AST):** Markdown documents are parsed into an Abstract Syntax Tree. Each node is given a deterministic SHA-256 Merkle-tree hash based on its content and children. We preserve physical geometry by tracking Spatial Bounding Boxes for every node.
2. **The Semantic Layer (Knowledge Graph):** LLMs process leaf nodes via asynchronous workers to extract strict Entities and Actions using Zod. We employ a pgvector hybrid fallback for robust similarity matching when topological traversal isn't enough.
3. **The Bridge:** Extracted entities point directly back to the physical AST Node IDs.

## Prerequisites
- Node.js (v18+)
- Docker Desktop (ensure the WSL 2 backend is running)
- An OpenAI API Key (`OPENAI_API_KEY`)

## Local Setup

1. **Clone the repository and install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment:**
   Set your OpenAI API key in your environment or a `.env` file:
   ```bash
   OPENAI_API_KEY=your_api_key_here
   ```

3. **Start the Infrastructure:**
   Spin up the Three-Tier database architecture (PostgreSQL, Neo4j, Redis) using Docker Compose:
   ```bash
   docker-compose up -d
   ```

4. **Initialize Databases:**
   Lock in the database schemas and uniqueness constraints:
   ```bash
   npx tsx src/config/init_db.ts
   ```

## Running the Engine

To run the Trellis pipeline locally, you need to boot both the ingestion server and the background extraction worker.

1. **Start the Extraction Worker:**
   ```bash
   npx tsx src/workers/extraction_worker.ts
   ```
2. **Start the API Server:**
   ```bash
   npx tsx src/api/server.ts
   ```
   The API will start on port `3000`.

For integration details on hitting the endpoints, see the [API Reference](API_REFERENCE.md).
