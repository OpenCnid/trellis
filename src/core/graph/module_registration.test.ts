import { describe, expect, it } from 'vitest';
import { readModuleManifest, type ModuleManifest } from '../../config/modules';
import {
  MODULE_ENTITY_KIND,
  MODULE_ENTITY_MERGE_CYPHER,
  describeMissingHashes,
  moduleEntityName,
  planModuleRegistrations,
  toModuleMergeParams,
} from './module_registration';

// Session 18 (design record §9.4): the pure half of module registration.
// The live MERGE/sweep/verify loop is drilled by npm run test:module-lifecycle.

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function manifestOf(overrides: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    name: 'research-mod',
    version: 2,
    purpose: 'A research-bearing module.',
    research: { sourceNodeIds: [HASH_A, HASH_B] },
    addendum: 'addendum.txt',
    tools: [],
    bounds: { addendumMaxBytes: 8192 },
    acceptance: { zeroPaid: 'npm run test:module -- research-mod' },
    status: 'active',
    kernelCompat: 1,
    ...overrides,
  };
}

describe('moduleEntityName', () => {
  it('derives the namespaced entity name (module: prefix keeps it out of retrieval)', () => {
    expect(moduleEntityName('spatial-flywheel')).toBe('module:spatial-flywheel');
  });

  it('is lowercase by construction (module name charset), matching the Entity name convention', () => {
    expect(moduleEntityName('my_mod-2')).toBe(moduleEntityName('my_mod-2').toLowerCase());
  });
});

describe('planModuleRegistrations', () => {
  it('plans a research-bearing active module with its exact hashes', () => {
    const plan = planModuleRegistrations([manifestOf()]);
    expect(plan.skipped).toEqual([]);
    expect(plan.registrations).toEqual([{
      moduleName: 'research-mod',
      entityName: 'module:research-mod',
      version: 2,
      sourceNodeIds: [HASH_A, HASH_B],
    }]);
  });

  it('dedupes repeated research hashes (one hash, one provenance element)', () => {
    const plan = planModuleRegistrations([
      manifestOf({ research: { sourceNodeIds: [HASH_A, HASH_A, HASH_B] } }),
    ]);
    expect(plan.registrations[0].sourceNodeIds).toEqual([HASH_A, HASH_B]);
  });

  it('skips empty-research modules (nothing for the sweep to reach)', () => {
    const plan = planModuleRegistrations([manifestOf({ research: { sourceNodeIds: [] } })]);
    expect(plan.registrations).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toBe('empty_research');
  });

  it('module #0 as committed registers nothing (the pinned no-op)', () => {
    const manifest = readModuleManifest('spatial-flywheel');
    const plan = planModuleRegistrations([manifest]);
    expect(plan.registrations).toEqual([]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({ moduleName: 'spatial-flywheel', reason: 'empty_research' }),
    ]);
  });

  it('skips contested and retired manifests (re-registration is the recovery transition)', () => {
    for (const status of ['contested', 'retired'] as const) {
      const plan = planModuleRegistrations([manifestOf({ status })]);
      expect(plan.registrations).toEqual([]);
      expect(plan.skipped[0].reason).toBe('inactive_status');
      expect(plan.skipped[0].message).toContain(status);
    }
  });

  it('plans and skips independently across a mixed registry', () => {
    const plan = planModuleRegistrations([
      manifestOf({ name: 'keeper' }),
      manifestOf({ name: 'empty', research: { sourceNodeIds: [] } }),
      manifestOf({ name: 'frozen', status: 'contested' }),
    ]);
    expect(plan.registrations.map(r => r.entityName)).toEqual(['module:keeper']);
    expect(plan.skipped.map(s => s.moduleName)).toEqual(['empty', 'frozen']);
  });
});

describe('toModuleMergeParams', () => {
  it('shapes the Cypher parameters with injected ids and the manifest kind', () => {
    const plan = planModuleRegistrations([manifestOf()]);
    let n = 0;
    const params = toModuleMergeParams(plan.registrations, () => `id-${++n}`);
    expect(params).toEqual({
      kind: MODULE_ENTITY_KIND,
      modules: [{
        id: 'id-1',
        entityName: 'module:research-mod',
        version: 2,
        sourceNodeIds: [HASH_A, HASH_B],
      }],
    });
  });

  it('the merge Cypher mirrors the applyRederivation discipline field-for-field', () => {
    // Structural pin, not a semantics proof (provenance.test.ts owns the
    // commutation proof): the ON MATCH must touch exactly the state
    // machine's fields plus the module stamps.
    expect(MODULE_ENTITY_MERGE_CYPHER).toContain('MERGE (e:Entity {name: mod.entityName})');
    for (const field of ['rederivedAt', 'sourceNodeIds', 'orphanedSourceIds', 'contested']) {
      expect(MODULE_ENTITY_MERGE_CYPHER).toContain(`e.${field}`);
    }
    expect(MODULE_ENTITY_MERGE_CYPHER).toContain('e.moduleVersion = mod.version');
  });
});

describe('describeMissingHashes', () => {
  it('lists missing hashes bounded with a remainder count', () => {
    const missing = Array.from({ length: 12 }, (_, i) => `${i}`.padStart(64, '0'));
    const text = describeMissingHashes(missing);
    expect(text).toContain('12 research hash(es) not found in ast_nodes');
    expect(text).toContain(missing[0]);
    expect(text).toContain(missing[9]);
    expect(text).not.toContain(missing[10]);
    expect(text).toContain('+2 more');
  });
});
