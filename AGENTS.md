# AGENTS.md — what Trellis is, and where everything else lives

Trellis is OpenCnid's Recursive Language Model runtime: a language model operating a persistent Python REPL over a provenance-enforced knowledge substrate. Two doctrines govern everything it stores and every code path that touches it — every semantic fact traces to immutable content-addressed source bytes, and the model never counts and never copies (code does: locations engine-computed, bytes moved by splice, answers submitted by reference). Authority across the committed record runs code > glossary > prose, and a collaborator's live instruction outranks all three.

## The one rule

**Fan out from this file as far as the work needs, and no further.** This trunk carries what Trellis is and where everything lives; every obligation, capability, and governing record sits one hop away, named in the index below. Before you act, open the ambient rules first, then the rule that fires on your kind of work, the skill that fits your task, the record that governs what you touch, and the nearest directory-scoped `AGENTS.md` where you edit — it adds local rules and never relaxes these.

## The tree

```text
AGENTS.md                  this file — the basis, the tree, the index, the one rule
AMBIENT.md                 the rules that bind every session, whatever the task
README.md                  bounded router into the repository
HANDOFF.md                 deprecated stub, kept for compatibility

src/
  core/
    ingestion/             the one verified ingest transaction every document crosses
    ast/                   Merkle AST construction and the markdown / code / PDF parsers
    graph/                 the semantic layer — provenance, quarantine, entity resolution, judges
    repository/            whole-repo snapshot ingestion
    promotion/             the only Tier-3 to Tier-1 bridge
    agent/                 the tool-free orchestrator that decomposes goals into tasks
    authoring/             grounded authoring against a seeded corpus
    llm/                   parseLlmResponse — the boundary every completion crosses
    a2a/                   the A2A external-protocol surface
    observability/         logging and bounded-label metrics
    async/  runtime/       concurrency and process lifecycle
  repl_sandbox/            the REPL isolation program — broker, policy, capabilities, DLP, guest RPC, Kata launcher
  rlm/                     the Python RLM harness — agent, tools, scaffold, blocks, answer / workspace / textedit / modules / mcp
  workers/                 BullMQ consumers and their job-parsing and prompt modules
  config/                  env validation and search_ast_nodes, the live-blocks-only retrieval seam
  api/                     the HTTP surface, thin over core
  benchmarks/              probe machinery — effective-context and scoring suites
  frontend/                dev-only Next.js UI, under its own AGENTS.md

modules/                   protocol modules — manifest plus brace-free addendum text
scripts/                   operator CLIs and zero-LLM drills

tools/
  repository-surface/      the root contract and its deterministic checker
  document-upsum/          section byte-ranking for governed documents
  density-chain/           the living-wiki checker for the system map
  engineering-loop/        the EL controller state machine

docs/
  architecture/            living doctrine — design records that lead implementation
  product/                 PRDs and active programs, the REPL-sandbox program among them
  operations/              operator manual and runbook
  benchmarks/              measured evidence behind every claim
  reference/               external protocol references
  density-chain/           the branching whole-system map
  archive/                 preserved history, never edited
  GLOSSARY.md              canonical definitions of every load-bearing term
  ORIENTATION.md           the system at five densities, and the per-record standing index
  COLLABORATOR_BRIEFING.md · RESEARCH_NOTES_COLLECTION.md   collaborator context and research notes

.claude/
  skills/                  the project skills, each firing on its kind of task
  rules/                   the per-task-type rule files, each firing on its kind of work
  ceremonies/              scheduled maintenance
  settings.json            hooks

data/  fixtures/  requirements/  .github/    durable corpora · test fixtures · pinned runtime · CI
```

## The index

Each line names a moment and hands you where it is settled. A rule fires on a kind of work, a skill on a kind of task, a record on a kind of question — match your moment to the name and open the one it points at.

### Rules that bind every session — `AMBIENT.md`

- **Taking the objective** — it comes from the collaborator's live task, and nowhere else.
- **A protected pause or owner gate** — it refuses the effect it names and nothing more; adjacent work stays live.
- **Calling a capability delivered** — correct is a different claim from reachable; name the non-test caller, or say there is none.
- **Deciding or claiming anything** — retrieve and quote the source this session; a lossy summary reads exactly like a faithful one.
- **An underdetermined instruction** — ask one question in the chat channel before reaching for any lever, then wait.

### Rules that bind a kind of work — `.claude/rules/`

- **Writing the AST, graph, provenance, promotion, or a retrieval surface** — `substrate-writes`.
- **Writing any text that primes a model** — `prompt-authoring`.
- **Building a judge, panel, rubric, defeater, or sub-agent** — `composed-evaluators`.
- **Designing a test or publishing a measured result** — `measurement-and-reporting`.
- **Spending money, or touching a live database, queue, or host** — `spend-and-live-infrastructure`.
- **Editing a byte-budgeted document or the navigation map** — `governed-documents`.
- **Authoring a commit or a pull request** — `commit-and-pr`.
- **Consuming a completion or changing an external surface** — `boundaries`.
- **Installing anything that persists past the session** — `standing-configuration`.

### Skills that equip a kind of task — `.claude/skills/`

- **Authoring any bytes that prime a model** — `prompt-engineering` then `hypershot-protocol`, before the first byte.
- **Composing a sub-agent** — `subagent-composition`.
- **Composing a judge panel** — `judge-composition`.
- **Weighing whether a complexity is warranted** — `complexity-convocation`.
- **Clean-room validation of an LLM feature** — `self-play`.
- **Running one turn of the self-improving loop** — `loop-orchestrator`.
- **Writing chain-of-density notes, or mapping the system** — `density-chain`.
- **Diagnosing which capability axis is short** — `spark-steering`.

### Records the work reaches for

- **Before any prose that uses a load-bearing term** — `docs/GLOSSARY.md`.
- **To orient at the shallowest density that answers you, and to learn a record's standing** — `docs/ORIENTATION.md`; D4 is the per-record standing index.
- **When two committed records disagree** — `docs/architecture/SESSION_GOVERNANCE.md` settles the session contract; the chain is code > glossary > prose, and a live instruction outranks it.
- **To see the whole system, branch by branch** — `docs/density-chain/`.
