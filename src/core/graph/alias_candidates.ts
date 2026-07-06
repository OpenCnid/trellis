import { TREC_LABELS } from './entity_kinds.js';

// Session 5 entity resolution: deterministic, LLM-free candidate
// generation. Entity identity is SHA-256(lowercase(name)) and stays
// immutable — this module only PROPOSES pairs that might denote the same
// real-world entity; an LLM (or the oracle in drills) adjudicates, and
// the verdict lands as an overlay SAME_AS/DISTINCT_FROM edge
// (alias_resolution.ts). Pure functions over in-memory entities: fully
// unit-testable with zero infrastructure.
//
// Kind discipline: only same-kind pairs, and only for kinds 'generic'
// and 'concept'. 'question' and 'category_label' are structural
// namespaces — the OOLONG flywheel resolves them by exact id, and an
// alias edge there would corrupt cache reads. Extraction-created
// entities carry no kind stamp (the merge Cypher predates kinds), so a
// NULL kind is treated as 'generic'. Because unstamped entities could in
// principle carry question-shaped names, question ids (q_<digits>) and
// the six TREC labels are additionally excluded BY NAME regardless of
// stamped kind.

export interface AliasEntity {
  /** Global deterministic id (SHA-256 of lowercased name). */
  id: string;
  /** Stored (lowercased) entity name. */
  name: string;
  type?: string;
  /** Stamped kind; null/undefined means pre-kind extraction output. */
  kind?: string | null;
  /** Live provenance at selection time. */
  sourceNodeIds: string[];
}

export type CandidateSignal = 'token_containment' | 'acronym' | 'edit_distance';

export interface CandidatePair {
  /** Canonical pair key: `${aId}|${bId}` with aId < bId lexicographically. */
  pairId: string;
  a: AliasEntity;
  b: AliasEntity;
  signal: CandidateSignal;
}

const RESOLVABLE_KINDS = new Set(['generic', 'concept']);
const QUESTION_NAME_PATTERN = /^q_\d+$/;
const TREC_LABEL_SET = new Set(TREC_LABELS);

/** Effective kind: unstamped (pre-kind) entities behave as 'generic'. */
export function effectiveKind(kind: string | null | undefined): string {
  return kind ?? 'generic';
}

/** True when the entity may participate in alias resolution at all. */
export function isResolvable(entity: Pick<AliasEntity, 'name' | 'kind'>): boolean {
  if (!RESOLVABLE_KINDS.has(effectiveKind(entity.kind))) return false;
  const name = entity.name.toLowerCase();
  if (QUESTION_NAME_PATTERN.test(name)) return false;
  if (TREC_LABEL_SET.has(name)) return false;
  return true;
}

/** Lowercased alphanumeric tokens of a name (punctuation-insensitive). */
export function normalizeTokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 0);
}

// Containment: every token of the shorter name appears in the longer
// one ("globex" ⊂ "globex corporation"). Requires at least one token of
// length >= 3 in the contained set so single stopword-like names cannot
// pair with everything containing them, and requires a strict subset so
// identical token sets fall through to the edit-distance signal.
function tokenContainment(aTokens: string[], bTokens: string[]): boolean {
  const [small, large] = aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  if (small.length === 0 || small.length >= large.length) return false;
  if (!small.some(t => t.length >= 3)) return false;
  const largeSet = new Set(large);
  return small.every(t => largeSet.has(t));
}

// Acronym: the initials of a multi-token name spell the other,
// single-token name ("international business machines" -> "ibm").
function acronymMatch(aTokens: string[], bTokens: string[]): boolean {
  const [single, multi] = aTokens.length === 1 ? [aTokens, bTokens] : [bTokens, aTokens];
  if (single.length !== 1 || multi.length < 2) return false;
  const initials = multi.map(t => t[0]).join('');
  return single[0] === initials;
}

/** Standard Levenshtein distance (small inputs only — entity names). */
export function editDistance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diag = prev[j];
      prev[j] = next;
    }
  }
  return prev[b.length];
}

// Near-identity guard: normalized names within edit distance 1 (2 for
// names of 12+ characters) propose — catches punctuation/typo/plural
// variants ("globex corp." vs "globex corp") without pairing genuinely
// different names.
function nearIdentity(aTokens: string[], bTokens: string[]): boolean {
  const aJoined = aTokens.join(' ');
  const bJoined = bTokens.join(' ');
  if (aJoined.length === 0 || bJoined.length === 0) return false;
  const threshold = Math.min(aJoined.length, bJoined.length) >= 12 ? 2 : 1;
  return editDistance(aJoined, bJoined) <= threshold;
}

/** Canonical pair key: lexicographically smaller entity id first. */
export function canonicalPairId(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

function classifySignal(a: AliasEntity, b: AliasEntity): CandidateSignal | undefined {
  const aTokens = normalizeTokens(a.name);
  const bTokens = normalizeTokens(b.name);
  if (tokenContainment(aTokens, bTokens)) return 'token_containment';
  if (acronymMatch(aTokens, bTokens)) return 'acronym';
  if (nearIdentity(aTokens, bTokens)) return 'edit_distance';
  return undefined;
}

/**
 * Proposes candidate alias pairs from a set of entities. Pure: the input
 * is never mutated. Output is deterministic — pairs are emitted in
 * canonical id order (smaller id first within a pair, pairs sorted by
 * pairId) and deduplicated, so the same entity set always yields the
 * same candidate list and the same `maxPairs` truncation.
 */
export function generateAliasCandidates(
  entities: readonly AliasEntity[],
  options: { maxPairs?: number; excludePairIds?: ReadonlySet<string> } = {}
): CandidatePair[] {
  const resolvable = entities.filter(isResolvable);
  const byKind = new Map<string, AliasEntity[]>();
  for (const entity of resolvable) {
    const kind = effectiveKind(entity.kind);
    const bucket = byKind.get(kind);
    if (bucket) bucket.push(entity);
    else byKind.set(kind, [entity]);
  }

  const seen = new Set<string>();
  const pairs: CandidatePair[] = [];
  for (const bucket of byKind.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const [x, y] = [bucket[i], bucket[j]];
        if (x.id === y.id) continue;
        const pairId = canonicalPairId(x.id, y.id);
        if (seen.has(pairId) || options.excludePairIds?.has(pairId)) continue;
        const signal = classifySignal(x, y);
        if (!signal) continue;
        seen.add(pairId);
        const [a, b] = x.id < y.id ? [x, y] : [y, x];
        pairs.push({ pairId, a, b, signal });
      }
    }
  }

  pairs.sort((p, q) => (p.pairId < q.pairId ? -1 : p.pairId > q.pairId ? 1 : 0));
  return options.maxPairs !== undefined ? pairs.slice(0, options.maxPairs) : pairs;
}
