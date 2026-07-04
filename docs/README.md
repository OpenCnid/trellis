# Trellis Engine Documentation

Welcome to the Trellis Engine documentation directory. Because Trellis relies on non-traditional, mathematically rigorous computer science concepts, we have separated our documentation into logical sections to help you onboard efficiently.

## Where to Start?

If you are new to the project, please read the documentation in the following order:

### 1. Product & Strategy (`/product`)
Start here to understand **why** Trellis was built and what problems it solves.
- **`PITCH-README.md`:** The high-level vision and elevator pitch.
- **`PRD.md`:** The Phase 1 MVP requirements and features.
- **`VALIDATION_STRATEGY.md`:** How we proved the theory before writing production code.
- **`PHASE_2_PRD.md`:** The roadmap for the next quarter (Frontend UI, Enterprise parsing, Vector fallbacks).
- **`PHASE_4_PRD.md`:** The invalidation loop (versioned re-ingestion, Merkle diff, quarantine sweep) and the Update Drill benchmark.
- **`PHASE_5_PRD.md`:** The verification layer (confidence-carrying writes, verifier worker, trust accrual, entity kinds) and the Poisoning Drill benchmark.

### 2. Architecture & Theory (`/architecture`)
Read these to understand **how** Trellis works under the hood.
- **`MATHEMATICAL_FOUNDATIONS.md`:** The core thesis—solving the "Shift Problem" with Merkle-trees.
- **`ARCHITECTURE.md` / `SYSTEM_ARCHITECTURE.md`:** Detailed breakdowns of the Physical Layer (AST), the Semantic Layer (Graph), and the LLM Extraction bridge.
- **`TECHNICAL_SPEC.md`:** The exact software requirements and technology stack used to build the MVP.

### 3. Operations (`/operations`)
For DevOps and Backend engineers monitoring the system.
- **`RUNBOOK.md`:** Diagnostic guide for Neo4j, PostgreSQL, and BullMQ queue management.

---
*Note: For immediate tactical developer setup (Docker, env vars, running the code, API endpoints), please refer to the `README.md` and `API_REFERENCE.md` at the root of the repository.*
