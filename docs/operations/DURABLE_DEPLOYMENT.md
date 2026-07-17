# Durable Deployment — Proposal for Owner Review

**Status: DECIDED — Option A (owner ruling, July 17, 2026).** The
stack runs on the owner's machine, locally, now: Docker Compose with
named volumes, backup sidecars, and the restore drill per §3/§5. The
build itself remains a bounded feature for an ordinary session; §5 is
its acceptance. §§1–4 below are preserved as the decision record.

## 1. What "durable deployment" means

A persistent instance of the three stores (PostgreSQL/pgvector,
Neo4j, Redis) plus the app, whose **data outlives containers and
sessions**. Today every stack the program touches is ephemeral — dev
compose environments and review containers — and the program's own
rule follows: *promotion in an ephemeral container mints provenance
that dies with the container* (`PROGRAM_CONTEXT.md` §6). Durable
deployment is not about uptime or serving traffic; it is about
**minted provenance being real**: an AST hash cited as
`sourceNodeIds` must still exist next month.

## 2. What it unblocks (and one honest non-blocker)

1. **Execution of the already-approved promotions** (owner rulings,
   July 16): the S1/S8 mirrors (S7 optional) ingested via
   `POST /ingest`, their block hashes becoming citable substrate.
2. **A home for the belief flywheel across sessions** — beliefs that
   persist between sessions are the product; without durability the
   flywheel resets to cold every time.
3. **The future `support_sweep` and verification cadence** (C2a) —
   sweeps only mean something over a store that persists.
4. **Module registration against durable research hashes** — the
   capability flywheel's next turns.

**Non-blocker, corrected:** CI wiring of `test:support-oracle` (C2b)
does NOT need this — the drill is fixture-based and DB-free and can
be wired into GitHub Actions today. An earlier session statement
implied otherwise; this document is the correction.

## 3. Options

| | A — Owner's machine | B — Small VPS | C — Managed services |
|---|---|---|---|
| Shape | Docker Compose, named volumes, backup sidecars | same Compose stack on a rented box | RDS-class Postgres + Neo4j Aura + managed Redis |
| Cost | ~$0 | ~$10–25/mo | ~$50+/mo |
| Effort | S–M (volumes exist; add backups + restore drill) | M (provisioning + access hygiene) | M (migration + config) |
| Risks | one disk, personal-machine uptime | networked surface — **C13 (write-path credential boundary) should land before any non-loopback deployment** | vendor coupling, cost |
| Fits | now | multi-collaborator later | the audit's sanctioned HA path (T3.4) |

Backup recipe (A and B, from the audit's T3.4): nightly `pg_dump` +
`neo4j-admin database dump` sidecars to a mounted backup volume, one
offsite copy, and a **documented restore drill** — a restore drill is
a zero-paid drill and belongs in the drill culture.

## 4. Recommendation

**A now; B or C when a second collaborator or networked access is
wanted; C13 strictly precedes any networked variant.** Option A
unblocks the approved promotions immediately at zero spend, on the
machine the owner already operates, with the backup recipe as the
only new machinery. The decision that matters this month is not
which infrastructure — it is *that provenance becomes durable at
all*.

## 5. Acceptance (when built, per the drill culture)

- Backup + restore drill documented and observed once (zero-paid).
- One approved promotion executed end-to-end; its root and block
  hashes recorded; a subsequent run cites them as `sourceNodeIds`.
- Disk-growth note recorded (bytes per document-version, per T3.4).

## 6. Decision asked

Pick A / B / C and schedule it — or defer with a dated note. If A:
the build is a bounded feature (compose backup sidecars + restore
drill + runbook section) and can ride an ordinary session.
