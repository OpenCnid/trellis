import type { Pool } from 'pg';
import type { Driver } from 'neo4j-driver';
import type { ModuleManifest } from '../../config/modules.js';

// Session 18 (design record §9.4, §11 step 6): the manifest-as-graph-entity
// representation — the machinery that makes a software capability
// automatically flagged for re-review when its research basis changes.
//
// A research-bearing module manifest is MERGEd as one ordinary
// (:Entity {kind: 'module_manifest'}) node whose sourceNodeIds are the
// manifest's research hashes. Because the node carries sourceNodeIds like
// every other semantic fact, the EXISTING invalidation sweep
// (src/core/graph/invalidation.ts) reaches it with zero sweep changes:
// when a re-promotion of refreshed external content orphans a research
// hash, the module entity is contested with the audit trail preserved.
//
// The loop stays human (Guardrail 4): the sweep contests the graph
// entity; the operator reads the verify report and flips the manifest
// `status` to 'contested' by hand (the Session 15 loader already refuses
// composing it); re-review and re-registration recover it. Nothing here
// edits manifest files, and nothing here is reachable from a model
// completion — registration is an operator running scripts/register_modules.ts.
//
// The `module:` name prefix keeps these entities out of every retrieval
// path that matches user-facing entity names: retrieval looks up
// lowercased natural-language names ("paris", "q_0001"), and the module
// name charset (^[a-z][a-z0-9_-]*$) plus the prefix makes collision with
// extracted content structurally impossible while staying trivially
// greppable in audits.

export const MODULE_ENTITY_KIND = 'module_manifest';
export const MODULE_ENTITY_PREFIX = 'module:';

/** Bounds the missing-hash echo in existence-gate refusals. */
const MISSING_HASH_LISTING_MAX = 10;

export function moduleEntityName(moduleName: string): string {
  return `${MODULE_ENTITY_PREFIX}${moduleName}`;
}

export interface ModuleRegistration {
  moduleName: string;
  entityName: string;
  version: number;
  sourceNodeIds: string[];
}

export interface SkippedModule {
  moduleName: string;
  reason: 'empty_research' | 'inactive_status';
  message: string;
}

export interface RegistrationPlan {
  registrations: ModuleRegistration[];
  skipped: SkippedModule[];
}

/**
 * Plans which manifests register. Two skips, both deliberate:
 *   - empty research (module #0): the entity would cite nothing and be
 *     unreachable by the sweep — registering it would be noise;
 *   - non-active status: re-registration un-contests the graph entity
 *     (the recovery transition), so registering a manifest the operator
 *     has marked contested/retired would silently undo the very
 *     quarantine the operator is acting on. Recovery is: re-review,
 *     flip status back to active, re-register.
 */
export function planModuleRegistrations(manifests: ModuleManifest[]): RegistrationPlan {
  const plan: RegistrationPlan = { registrations: [], skipped: [] };
  for (const manifest of manifests) {
    if (manifest.status !== 'active') {
      plan.skipped.push({
        moduleName: manifest.name,
        reason: 'inactive_status',
        message: `status '${manifest.status}' — re-registration would un-contest its graph entity; `
          + 're-review and flip status back to active first',
      });
      continue;
    }
    if (manifest.research.sourceNodeIds.length === 0) {
      plan.skipped.push({
        moduleName: manifest.name,
        reason: 'empty_research',
        message: 'no research provenance — nothing for the sweep to reach; registration is a no-op',
      });
      continue;
    }
    plan.registrations.push({
      moduleName: manifest.name,
      entityName: moduleEntityName(manifest.name),
      version: manifest.version,
      sourceNodeIds: [...new Set(manifest.research.sourceNodeIds)],
    });
  }
  return plan;
}

/**
 * The research existence gate (Session 14 discipline applied to
 * capability provenance): every cited hash must exist in ast_nodes
 * BEFORE any write session opens. Returns the missing hashes in cited
 * order (deduped); a non-empty return means the whole invocation must
 * refuse — a manifest citing 64 well-formed hex chars that correspond
 * to nothing is exactly the defect this gate exists to catch.
 */
export async function findMissingAstHashes(db: Pool, hashes: readonly string[]): Promise<string[]> {
  const unique = [...new Set(hashes)];
  if (unique.length === 0) return [];
  const res = await db.query('SELECT id FROM ast_nodes WHERE id = ANY($1::varchar[])', [unique]);
  const present = new Set(res.rows.map((row: { id: string }) => row.id));
  return unique.filter(h => !present.has(h));
}

/** Bounded echo for existence-gate refusals (never the full corpus). */
export function describeMissingHashes(missing: readonly string[]): string {
  const shown = missing.slice(0, MISSING_HASH_LISTING_MAX);
  const suffix = missing.length > shown.length ? `, +${missing.length - shown.length} more` : '';
  return `${missing.length} research hash(es) not found in ast_nodes: ${shown.join(', ')}${suffix}`;
}

// ON MATCH mirrors applyRederivation in provenance.ts — the identical
// discipline extraction_merge.ts carries, so the sweep transition and
// this registration commute (provenance.test.ts proves the state
// machine's commutation):
//   - re-registration with live hashes un-contests and stamps rederivedAt;
//   - previously recorded hashes the ledger knows are dead stay out of
//     the live set; a re-cited hash that was once orphaned is resurrected
//     (re-promoting the original bytes re-creates the old content hash);
//   - orphanedSourceIds remain as audit history, minus resurrections.
// kind and moduleVersion re-stamp on every registration so a manifest
// version bump is visible on the entity.
export const MODULE_ENTITY_MERGE_CYPHER = `
  UNWIND $modules AS mod
  MERGE (e:Entity {name: mod.entityName})
  ON CREATE SET e.id = mod.id, e.kind = $kind, e.moduleVersion = mod.version,
    e.sourceNodeIds = mod.sourceNodeIds
  ON MATCH SET
    e.rederivedAt = CASE WHEN coalesce(e.contested, false) THEN timestamp() ELSE e.rederivedAt END,
    e.sourceNodeIds = [h IN coalesce(e.sourceNodeIds, [])
                       WHERE NOT h IN mod.sourceNodeIds
                         AND NOT h IN coalesce(e.orphanedSourceIds, [])]
                      + mod.sourceNodeIds,
    e.orphanedSourceIds = CASE WHEN e.orphanedSourceIds IS NULL THEN NULL
                               ELSE [h IN e.orphanedSourceIds WHERE NOT h IN mod.sourceNodeIds] END,
    e.contested = false,
    e.kind = $kind,
    e.moduleVersion = mod.version
  RETURN mod.entityName AS entityName
`;

export interface ModuleMergeParams {
  kind: string;
  modules: Array<{
    id: string;
    entityName: string;
    version: number;
    sourceNodeIds: string[];
  }>;
}

/** Pure parameter shaping; the id factory is injected so tests stay deterministic. */
export function toModuleMergeParams(
  registrations: readonly ModuleRegistration[],
  mintId: () => string
): ModuleMergeParams {
  return {
    kind: MODULE_ENTITY_KIND,
    modules: registrations.map(reg => ({
      id: mintId(),
      entityName: reg.entityName,
      version: reg.version,
      sourceNodeIds: reg.sourceNodeIds,
    })),
  };
}

/** Merges every planned registration in a single transaction. Idempotent. */
export async function registerModuleEntities(
  driver: Driver,
  registrations: readonly ModuleRegistration[],
  mintId: () => string
): Promise<string[]> {
  if (registrations.length === 0) return [];
  const session = driver.session();
  try {
    const res = await session.executeWrite(tx =>
      tx.run(MODULE_ENTITY_MERGE_CYPHER, toModuleMergeParams(registrations, mintId))
    );
    return res.records.map(record => record.get('entityName') as string);
  } finally {
    await session.close();
  }
}

export interface ModuleEntityState {
  entityName: string;
  moduleVersion: number | null;
  sourceNodeIds: string[];
  orphanedSourceIds: string[];
  contested: boolean;
  contestedAt: number | null;
  rederivedAt: number | null;
}

const MODULE_ENTITY_STATE_CYPHER = `
  MATCH (e:Entity {kind: $kind})
  RETURN e.name AS entityName,
         e.moduleVersion AS moduleVersion,
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

/** The verify-mode read: every registered module entity's provenance state. */
export async function fetchModuleEntityStates(driver: Driver): Promise<ModuleEntityState[]> {
  const session = driver.session();
  try {
    const res = await session.executeRead(tx =>
      tx.run(MODULE_ENTITY_STATE_CYPHER, { kind: MODULE_ENTITY_KIND })
    );
    return res.records.map(record => ({
      entityName: record.get('entityName') as string,
      moduleVersion: toNullableNumber(record.get('moduleVersion')),
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
