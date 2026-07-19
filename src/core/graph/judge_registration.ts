/**
 * Judge registration: the split representation — store-resident
 * manifests, graph-resident contest hooks.
 *
 * Normative specification:
 *   docs/product/epistemic-support/JUDGE_CONVOCATION_DESIGN.md §3.1, on
 *   the Session 18 module-registry mold (module_registration.ts), under
 *   RECONCILIATION.md §3.4 (registry/contest law) and R-27 (manifests
 *   are model-coupled; `targetModelIdentity` REQUIRED — already
 *   schema-pinned in judge_panel.ts).
 *
 * The split (the §3.1 decision): the full JudgeManifest lives in the
 * convocation store, which no RLM surface reads; the shared graph
 * carries ONLY an opaque hook — `(:Entity {kind: 'judge_manifest'})`
 * named `judge:<judgeId>` whose sourceNodeIds are the judge's
 * evidentiary hashes. The hook exists so the EXISTING invalidation
 * sweep contests a judge whose evidentiary bytes die, with zero sweep
 * changes; it carries no role, no model identity, no shas — AB-5's
 * model-visible surface is an opaque id and hashes, nothing a writer
 * can shape behavior against (residual named in the record's §9 with
 * its falsifier).
 *
 * Consistency is a refusal, not a hope: one operator ceremony writes
 * both sides, and a sweep run that finds a manifest without its hook —
 * or a hook without its manifest — refuses the run naming the judge.
 *
 * Recovery follows re-review (the module mold's rule): re-merging a
 * CONTESTED hook is the recovery transition and requires a named human
 * reviewer at the ceremony; registering a brand-new judge never
 * un-contests anything because a fresh entity has nothing to recover.
 * A manifest CHANGE is a new registration under a new judgeId
 * (judge_panel.ts registry law — editing is a new registration).
 */

import type { Driver } from 'neo4j-driver';
import type { Pool } from 'pg';
import { parseJudgeManifest, registerJudge, contestJudge, emptyRegistry, type JudgeRegistry } from './judge_panel';
import type { JudgeManifestPayload } from './judge_convocation_store';

export const JUDGE_ENTITY_KIND = 'judge_manifest';
export const JUDGE_ENTITY_PREFIX = 'judge:';

/** The module-registry charset: collision with extracted content structurally impossible. */
const JUDGE_ID_CHARSET = /^[a-z][a-z0-9_-]*$/;

const MISSING_HASH_LISTING_MAX = 10;

export function judgeEntityName(judgeId: string): string {
  return `${JUDGE_ENTITY_PREFIX}${judgeId}`;
}

export class JudgeRegistrationError extends Error {}

export class ConvocationConsistencyError extends Error {
  constructor(public readonly judgeId: string, side: 'manifest' | 'hook') {
    super(
      side === 'hook'
        ? `Convocation refused: judge "${judgeId}" has a store manifest but no graph contest hook — ` +
          `the registration ceremony is not atomic in practice; re-register before any run.`
        : `Convocation refused: graph hook "${judgeEntityName(judgeId)}" has no store manifest — ` +
          `the registration ceremony is not atomic in practice; re-register before any run.`
    );
  }
}

// ---------------------------------------------------------------------------
// Planning (pure)
// ---------------------------------------------------------------------------

export interface JudgeRegistrationInput {
  manifest: unknown;
  sourceNodeIds: string[];
}

export interface PlannedJudgeRegistration {
  judgeId: string;
  entityName: string;
  manifest: ReturnType<typeof parseJudgeManifest>;
  sourceNodeIds: string[];
}

/**
 * Validates and plans a registration batch. Refusals, all fail-fast:
 * malformed manifest (the judge_panel schema, R-27 included), a judgeId
 * outside the entity charset, a duplicate in the batch or the store,
 * and an EMPTY evidentiary basis — a judge citing nothing would be
 * unreachable by the sweep, and an uncontestable judge is exactly what
 * the capability flywheel forbids (EPISTEMIC_SUPPORT §5).
 */
export function planJudgeRegistrations(
  inputs: readonly JudgeRegistrationInput[],
  existingJudgeIds: ReadonlySet<string>
): PlannedJudgeRegistration[] {
  const planned: PlannedJudgeRegistration[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const manifest = parseJudgeManifest(input.manifest);
    if (!JUDGE_ID_CHARSET.test(manifest.judgeId)) {
      throw new JudgeRegistrationError(
        `Registration refused: judgeId "${manifest.judgeId}" is outside the entity charset ` +
        `(^[a-z][a-z0-9_-]*$) — the judge: prefix guarantee needs it.`
      );
    }
    if (seen.has(manifest.judgeId) || existingJudgeIds.has(manifest.judgeId)) {
      throw new JudgeRegistrationError(
        `Registration refused: judge "${manifest.judgeId}" is already registered — a manifest ` +
        `change is a NEW registration under a NEW judgeId (registry law).`
      );
    }
    const sourceNodeIds = [...new Set(input.sourceNodeIds)];
    if (sourceNodeIds.length === 0) {
      throw new JudgeRegistrationError(
        `Registration refused: judge "${manifest.judgeId}" cites no evidentiary hashes — an ` +
        `uncontestable judge is unreachable by the sweep (anchor discipline, EPISTEMIC_SUPPORT §5).`
      );
    }
    seen.add(manifest.judgeId);
    planned.push({ judgeId: manifest.judgeId, entityName: judgeEntityName(manifest.judgeId), manifest, sourceNodeIds });
  }
  return planned;
}

// ---------------------------------------------------------------------------
// The existence gate (Session 14 discipline; the module-registry mold)
// ---------------------------------------------------------------------------

export async function findMissingEvidentiaryHashes(db: Pool, hashes: readonly string[]): Promise<string[]> {
  const unique = [...new Set(hashes)];
  if (unique.length === 0) return [];
  const res = await db.query('SELECT id FROM ast_nodes WHERE id = ANY($1::varchar[])', [unique]);
  const present = new Set(res.rows.map((row: { id: string }) => row.id));
  return unique.filter((h) => !present.has(h));
}

export function describeMissingEvidentiaryHashes(missing: readonly string[]): string {
  const shown = missing.slice(0, MISSING_HASH_LISTING_MAX);
  const suffix = missing.length > shown.length ? `, +${missing.length - shown.length} more` : '';
  return `${missing.length} evidentiary hash(es) not found in ast_nodes: ${shown.join(', ')}${suffix}`;
}

// ---------------------------------------------------------------------------
// The graph hook (opaque; the module MERGE mold minus everything readable)
// ---------------------------------------------------------------------------

// ON MATCH mirrors module_registration.ts, which mirrors
// applyRederivation: re-merging a contested hook un-contests it and
// stamps rederivedAt (the recovery transition); dead hashes the ledger
// knows stay out of the live set; orphan history survives minus
// resurrections. The hook deliberately carries NOTHING beyond name,
// id, kind, and hashes.
export const JUDGE_ENTITY_MERGE_CYPHER = `
  UNWIND $judges AS j
  MERGE (e:Entity {name: j.entityName})
  ON CREATE SET e.id = j.id, e.kind = $kind, e.sourceNodeIds = j.sourceNodeIds
  ON MATCH SET
    e.rederivedAt = CASE WHEN coalesce(e.contested, false) THEN timestamp() ELSE e.rederivedAt END,
    e.sourceNodeIds = [h IN coalesce(e.sourceNodeIds, [])
                       WHERE NOT h IN j.sourceNodeIds
                         AND NOT h IN coalesce(e.orphanedSourceIds, [])]
                      + j.sourceNodeIds,
    e.orphanedSourceIds = CASE WHEN e.orphanedSourceIds IS NULL THEN NULL
                               ELSE [h IN e.orphanedSourceIds WHERE NOT h IN j.sourceNodeIds] END,
    e.contested = false,
    e.kind = $kind
  RETURN j.entityName AS entityName
`;

export async function mergeJudgeEntities(
  driver: Driver,
  planned: readonly Pick<PlannedJudgeRegistration, 'entityName' | 'sourceNodeIds'>[],
  mintId: () => string
): Promise<string[]> {
  if (planned.length === 0) return [];
  const session = driver.session();
  try {
    const res = await session.executeWrite((tx) =>
      tx.run(JUDGE_ENTITY_MERGE_CYPHER, {
        kind: JUDGE_ENTITY_KIND,
        judges: planned.map((p) => ({ id: mintId(), entityName: p.entityName, sourceNodeIds: p.sourceNodeIds })),
      })
    );
    return res.records.map((record) => record.get('entityName') as string);
  } finally {
    await session.close();
  }
}

export interface JudgeEntityState {
  entityName: string;
  sourceNodeIds: string[];
  orphanedSourceIds: string[];
  contested: boolean;
  contestedAt: number | null;
  rederivedAt: number | null;
}

const JUDGE_ENTITY_STATE_CYPHER = `
  MATCH (e:Entity {kind: $kind})
  RETURN e.name AS entityName,
         coalesce(e.sourceNodeIds, []) AS sourceNodeIds,
         coalesce(e.orphanedSourceIds, []) AS orphanedSourceIds,
         coalesce(e.contested, false) AS contested,
         e.contestedAt AS contestedAt,
         e.rederivedAt AS rederivedAt
  ORDER BY e.name
`;

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  return (value as { toNumber: () => number }).toNumber();
}

export async function fetchJudgeEntityStates(driver: Driver): Promise<JudgeEntityState[]> {
  const session = driver.session();
  try {
    const res = await session.executeRead((tx) => tx.run(JUDGE_ENTITY_STATE_CYPHER, { kind: JUDGE_ENTITY_KIND }));
    return res.records.map((record) => ({
      entityName: record.get('entityName') as string,
      sourceNodeIds: record.get('sourceNodeIds') as string[],
      orphanedSourceIds: record.get('orphanedSourceIds') as string[],
      contested: record.get('contested') as boolean,
      contestedAt: toNullableNumber(record.get('contestedAt')),
      rederivedAt: toNullableNumber(record.get('rederivedAt')),
    }));
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// Registry assembly (pure): store manifests × graph contest state
// ---------------------------------------------------------------------------

/**
 * Builds the pure JudgeRegistry a sweep run consumes. Every store
 * manifest must have its graph hook and every judge_manifest hook its
 * store manifest — a mismatch refuses the RUN, typed, naming the judge
 * (the ceremony writes both sides; drift means it is not atomic in
 * practice). Contest state carries over from the graph, so composePanel
 * refuses a contested judge exactly as its drilled law requires.
 */
export function buildRegistryFromState(
  manifests: ReadonlyMap<string, JudgeManifestPayload>,
  graphStates: readonly JudgeEntityState[]
): JudgeRegistry {
  const hookByName = new Map(graphStates.map((s) => [s.entityName, s]));
  for (const state of graphStates) {
    const judgeId = state.entityName.startsWith(JUDGE_ENTITY_PREFIX)
      ? state.entityName.slice(JUDGE_ENTITY_PREFIX.length)
      : state.entityName;
    if (!manifests.has(judgeId)) throw new ConvocationConsistencyError(judgeId, 'manifest');
  }
  let registry = emptyRegistry();
  for (const [judgeId, payload] of [...manifests.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const hook = hookByName.get(judgeEntityName(judgeId));
    if (!hook) throw new ConvocationConsistencyError(judgeId, 'hook');
    registry = registerJudge(registry, payload.manifest);
    if (hook.contested) {
      registry = contestJudge(registry, judgeId, {
        finding: 'graph_contest',
        reason: 'evidentiary basis contested in the graph (invalidation sweep or operator act)',
        contestedAtMs: hook.contestedAt ?? 0,
      });
    }
  }
  return registry;
}
