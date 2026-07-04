// The belief-provenance state machine — the executable specification for
// every Cypher writer that touches contested/sourceNodeIds/orphanedSourceIds.
//
// A semantic fact (Entity/Question node, ACTION/REFERENCES/DERIVED_INSIGHT
// edge) carries three provenance fields:
//
//   sourceNodeIds     — live Merkle hashes that currently justify the fact
//   orphanedSourceIds — hashes whose bytes a re-ingest killed (audit trail,
//                       kept forever — the append-only belief ledger)
//   contested         — the fact is excluded from effective resolution
//                       (/retrieve, agent cache reads) until re-derived
//                       from live bytes
//
// Exactly two transitions mutate this state:
//
//   applyQuarantineSweep  — a re-ingest's orphan set arrives (invalidation
//                           worker, src/core/graph/invalidation.ts)
//   applyRederivation     — the fact is re-asserted from live bytes
//                           (extraction worker via extraction_merge.ts, or
//                           the RLM's write_derived_insight in
//                           src/rlm/trellis_tools.py)
//
// THE ORDER-INDEPENDENCE REQUIREMENT: within one re-ingest, the quarantine
// sweep and the re-extraction jobs race — BullMQ gives no ordering between
// the invalidation_queue and extraction_queue workers. The two transitions
// therefore MUST commute for that re-ingest's inputs (rederived hashes are
// a subset of the sweep's fresh set and disjoint from its orphan set, which
// /ingest guarantees: fresh = diff.added blocks, orphaned = diff.orphaned,
// and added ∩ orphaned = ∅ by construction). provenance.test.ts proves the
// commutation exhaustively over a small hash universe.
//
// Semantics preserved from PHASE_4_PRD.md §5: mixed provenance is still
// contested conservatively — a fact whose sources are part-dead, part-live
// is quarantined UNLESS one of its live sources is in the re-ingest's fresh
// set (i.e. the fact was just re-derived from the new bytes; that is the
// recovery this module exists to guarantee). A fact supported only by
// retained (unchanged) blocks stays quarantined until re-derived on demand,
// exactly as the PRD's lazy re-derivation story specifies.

export interface BeliefProvenance {
  /** Hashes currently believed live that justify the fact. */
  sourceNodeIds: string[];
  /** Hashes orphaned by re-ingests — audit history, never deleted. */
  orphanedSourceIds: string[];
  /** Quarantined: hidden from effective resolution until re-derived. */
  contested: boolean;
}

/**
 * One re-ingest's quarantine sweep hits a fact.
 *
 * `orphaned` is the re-ingest's dead-hash set (Merkle diff old \ new);
 * `fresh` is its re-derivation set — the block hashes of this version that
 * were queued for extraction (diff new \ old). A fact none of whose sources
 * intersect the orphan set is untouched (mirrors the sweep's WHERE clause).
 * Otherwise dead hashes move into orphanedSourceIds, and the fact is
 * quarantined unless a surviving source is fresh — fresh provenance means a
 * racing re-extraction already re-derived the fact from live bytes, and the
 * sweep must not re-quarantine it (order independence).
 */
export function applyQuarantineSweep(
  state: BeliefProvenance,
  orphaned: ReadonlySet<string>,
  fresh: ReadonlySet<string>
): BeliefProvenance {
  if (!state.sourceNodeIds.some(h => orphaned.has(h))) return state;

  const liveSources = state.sourceNodeIds.filter(h => !orphaned.has(h));
  const newlyOrphaned = state.sourceNodeIds.filter(
    h => orphaned.has(h) && !state.orphanedSourceIds.includes(h)
  );
  const rederivedFromLiveBytes = liveSources.some(h => fresh.has(h));
  return {
    sourceNodeIds: liveSources,
    orphanedSourceIds: [...state.orphanedSourceIds, ...newlyOrphaned],
    contested: rederivedFromLiveBytes ? state.contested : true
  };
}

/**
 * The fact is re-asserted with `incoming` provenance — hashes that are live
 * by construction (the extraction worker checks its block against the
 * document registry before writing; see isAstNodeLive in
 * src/core/ast/registry.ts).
 *
 * Re-derivation from live bytes always clears the quarantine. Previously
 * recorded sources that the ledger knows are dead stay filtered out of
 * sourceNodeIds; an incoming hash that was once orphaned is resurrected
 * (removed from orphanedSourceIds) — reverting a document to an earlier
 * version re-creates the earlier content hash, and those bytes are live
 * again.
 */
export function applyRederivation(
  state: BeliefProvenance,
  incoming: readonly string[]
): BeliefProvenance {
  const kept = state.sourceNodeIds.filter(
    h => !incoming.includes(h) && !state.orphanedSourceIds.includes(h)
  );
  return {
    sourceNodeIds: [...kept, ...incoming],
    orphanedSourceIds: state.orphanedSourceIds.filter(h => !incoming.includes(h)),
    contested: false
  };
}
