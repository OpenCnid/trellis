import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EL02_REQUIREMENT_EVIDENCE,
  EL03_REQUIREMENT_EVIDENCE,
  EL04_REQUIREMENT_EVIDENCE,
  EL05_REQUIREMENT_EVIDENCE,
  EL06_REQUIREMENT_EVIDENCE,
  EL10_REQUIREMENT_EVIDENCE,
} from '../src/requirements';

function requirementIds(spec: string, feature: string): string[] {
  return [...spec.matchAll(new RegExp(`^\\| \`(EL-REQ-[A-Z]+-\\d{3})\` \\| \`${feature}\` \\|`, 'gm'))]
    .map(match => match[1])
    .sort();
}

describe('EL-02 normative linkage', () => {
  it('maps every and only EL-02-owned requirement in the SPEC conformance matrix', async () => {
    const spec = await readFile(resolve('tools/engineering-loop/SPEC.md'), 'utf8');
    const computed = requirementIds(spec, 'EL-02');
    const mapped = EL02_REQUIREMENT_EVIDENCE.map(item => item.requirement).sort();
    expect(computed).toHaveLength(28);
    expect(new Set(mapped).size).toBe(28);
    expect(mapped).toEqual(computed);
  });

  it('independently computes and pins every and only EL-03-owned conformance row', async () => {
    const spec = await readFile(resolve('tools/engineering-loop/SPEC.md'), 'utf8');
    const computed = requirementIds(spec, 'EL-03');
    expect(computed).toEqual([
      'EL-REQ-DATA-006',
      'EL-REQ-OBS-005',
      'EL-REQ-REPO-001',
      'EL-REQ-REPO-002',
      'EL-REQ-REPO-003',
      'EL-REQ-REPO-004',
      'EL-REQ-REPO-005',
      'EL-REQ-REPO-006',
      'EL-REQ-VIEW-001',
      'EL-REQ-VIEW-002',
      'EL-REQ-VIEW-003',
      'EL-REQ-VIEW-005',
    ]);
    const mapped = EL03_REQUIREMENT_EVIDENCE.map(item => item.requirement).sort();
    expect(computed).toHaveLength(12);
    expect(new Set(mapped).size).toBe(12);
    expect(mapped).toEqual(computed);
  });

  it('links all 12 EL-03 rows to concrete TypeScript sources and deterministic named tests', async () => {
    for (const evidence of EL03_REQUIREMENT_EVIDENCE) {
      expect(evidence.source.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.every(test => test.includes(':'))).toBe(true);
      for (const source of evidence.source) {
        expect(source.endsWith('.ts')).toBe(true);
        await expect(readFile(resolve('tools/engineering-loop/src', source), 'utf8')).resolves.not.toHaveLength(0);
      }
    }
  });

  it('independently computes and pins every and only EL-04-owned conformance row', async () => {
    const spec = await readFile(resolve('tools/engineering-loop/SPEC.md'), 'utf8');
    const computed = requirementIds(spec, 'EL-04');
    expect(computed).toEqual([
      'EL-REQ-PROMPT-001',
      'EL-REQ-PROMPT-002',
      'EL-REQ-PROMPT-003',
      'EL-REQ-PROMPT-004',
      'EL-REQ-PROMPT-005',
      'EL-REQ-PROMPT-006',
      'EL-REQ-PROMPT-007',
    ]);
    const mapped = EL04_REQUIREMENT_EVIDENCE.map(item => item.requirement).sort();
    expect(computed).toHaveLength(7);
    expect(new Set(mapped).size).toBe(7);
    expect(mapped).toEqual(computed);
  });

  it('links all seven EL-04 rows to concrete TypeScript sources and deterministic named tests', async () => {
    for (const evidence of EL04_REQUIREMENT_EVIDENCE) {
      expect(evidence.source.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.every(test => test.includes(':'))).toBe(true);
      for (const source of evidence.source) {
        expect(source.endsWith('.ts')).toBe(true);
        await expect(readFile(resolve('tools/engineering-loop/src', source), 'utf8')).resolves.not.toHaveLength(0);
      }
    }
  });

  it('independently computes and pins every and only EL-05-owned conformance row', async () => {
    const spec = await readFile(resolve('tools/engineering-loop/SPEC.md'), 'utf8');
    const computed = requirementIds(spec, 'EL-05');
    expect(computed).toEqual([
      'EL-REQ-EPISODE-001',
      'EL-REQ-EPISODE-002',
      'EL-REQ-EPISODE-003',
      'EL-REQ-EPISODE-005',
      'EL-REQ-EPISODE-006',
      'EL-REQ-EPISODE-007',
      'EL-REQ-EPISODE-008',
      'EL-REQ-OBS-001',
      'EL-REQ-RUNNER-001',
      'EL-REQ-RUNNER-002',
      'EL-REQ-RUNNER-003',
      'EL-REQ-RUNNER-005',
      'EL-REQ-RUNNER-006',
      'EL-REQ-RUNNER-007',
      'EL-REQ-RUNNER-008',
    ]);
    const mapped = EL05_REQUIREMENT_EVIDENCE.map(item => item.requirement).sort();
    expect(computed).toHaveLength(15);
    expect(new Set(mapped).size).toBe(15);
    expect(mapped).toEqual(computed);
  });

  it('links all 15 EL-05 rows to concrete TypeScript sources and deterministic named tests', async () => {
    for (const evidence of EL05_REQUIREMENT_EVIDENCE) {
      expect(evidence.source.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.every(test => test.includes(':'))).toBe(true);
      for (const source of evidence.source) {
        expect(source.endsWith('.ts')).toBe(true);
        await expect(readFile(resolve('tools/engineering-loop/src', source), 'utf8')).resolves.not.toHaveLength(0);
      }
    }
  });

  it('independently computes and pins every and only EL-06-owned conformance row', async () => {
    const spec = await readFile(resolve('tools/engineering-loop/SPEC.md'), 'utf8');
    const computed = requirementIds(spec, 'EL-06');
    expect(computed).toEqual([
      'EL-REQ-APPROVAL-001', 'EL-REQ-APPROVAL-002', 'EL-REQ-APPROVAL-003',
      'EL-REQ-APPROVAL-004', 'EL-REQ-APPROVAL-005', 'EL-REQ-APPROVAL-006',
      'EL-REQ-APPROVAL-007', 'EL-REQ-APPROVAL-008', 'EL-REQ-APPROVAL-009',
      'EL-REQ-DATA-003', 'EL-REQ-DATA-005', 'EL-REQ-EPISODE-004',
      'EL-REQ-OBS-002', 'EL-REQ-OBS-004', 'EL-REQ-OBS-006', 'EL-REQ-OBS-007',
      'EL-REQ-RECOVERY-001', 'EL-REQ-RECOVERY-002', 'EL-REQ-RECOVERY-003',
      'EL-REQ-RECOVERY-007', 'EL-REQ-RECOVERY-009', 'EL-REQ-RECOVERY-010',
      'EL-REQ-SEC-002', 'EL-REQ-SEC-003', 'EL-REQ-SEC-004', 'EL-REQ-SEC-005',
      'EL-REQ-STATE-005', 'EL-REQ-STATE-007', 'EL-REQ-STATE-010',
      'EL-REQ-VERIFY-001', 'EL-REQ-VERIFY-002', 'EL-REQ-VERIFY-003', 'EL-REQ-VERIFY-004',
      'EL-REQ-VERIFY-005', 'EL-REQ-VERIFY-006', 'EL-REQ-VERIFY-007',
    ]);
    const mapped = EL06_REQUIREMENT_EVIDENCE.map(item => item.requirement).sort();
    expect(computed).toHaveLength(36);
    expect(new Set(mapped).size).toBe(36);
    expect(mapped).toEqual(computed);
  });

  it('links all 36 EL-06 rows one-to-one to concrete TypeScript sources and deterministic named tests', async () => {
    for (const evidence of EL06_REQUIREMENT_EVIDENCE) {
      expect(evidence.source.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.every(test => test.includes(':'))).toBe(true);
      for (const source of evidence.source) {
        expect(source.endsWith('.ts')).toBe(true);
        await expect(readFile(resolve('tools/engineering-loop/src', source), 'utf8')).resolves.not.toHaveLength(0);
      }
    }
  });

  it('independently computes and pins every and only EL-10-owned conformance row', async () => {
    const spec = await readFile(resolve('tools/engineering-loop/SPEC.md'), 'utf8');
    const computed = requirementIds(spec, 'EL-10');
    expect(computed).toEqual([
      'EL-REQ-BOOT-001',
      'EL-REQ-BOOT-002',
      'EL-REQ-BOOT-003',
      'EL-REQ-BOOT-004',
      'EL-REQ-BOOT-005',
      'EL-REQ-BOOT-006',
      'EL-REQ-BOOT-007',
    ]);
    const mapped = EL10_REQUIREMENT_EVIDENCE.map(item => item.requirement).sort();
    expect(computed).toHaveLength(7);
    expect(new Set(mapped).size).toBe(7);
    expect(mapped).toEqual(computed);
  });

  it('links all seven EL-10 rows to concrete TypeScript sources and deterministic named tests', async () => {
    for (const evidence of EL10_REQUIREMENT_EVIDENCE) {
      expect(evidence.source.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.every(test => test.includes(':'))).toBe(true);
      for (const source of evidence.source) {
        expect(source.endsWith('.ts')).toBe(true);
        await expect(readFile(resolve('tools/engineering-loop/src', source), 'utf8')).resolves.not.toHaveLength(0);
      }
    }
  });

  it('resolves every EL-10 named test to a real test that exists', async () => {
    // The shared linkage assertion above checks the *shape* of a test name, not
    // that the test exists. Under it, evidence naming a test that was renamed or
    // never written still passes, so "deterministically verified" would rest on
    // author care rather than on a check that can fail.
    //
    // EL-10 names its tests as literal `it(...)` titles, so the claim is
    // machine-checkable and is checked here. This binds EL-10 only; EL-02
    // through EL-06 use a human-readable `module: concept` pointer convention
    // and are accepted as they stand.
    const directory = resolve('tools/engineering-loop/tests');
    const corpus = (await Promise.all(
      (await readdir(directory))
        .filter(file => file.endsWith('.test.ts'))
        .map(file => readFile(resolve(directory, file), 'utf8'))
    )).join('\n');

    const named = EL10_REQUIREMENT_EVIDENCE.flatMap(evidence =>
      evidence.tests.map(test => ({ requirement: evidence.requirement, test }))
    );
    expect(named.length).toBeGreaterThanOrEqual(EL10_REQUIREMENT_EVIDENCE.length);
    for (const { requirement, test } of named) {
      expect(corpus, `${requirement} names '${test}', which resolves to no test`).toContain(`it('${test}'`);
    }
  });

  it('EL-10-A3: the catalog carries no mutable status and names the exact authority', async () => {
    const raw = await readFile(resolve('docs/product/engineering-loop/features.json'), 'utf8');
    const catalog = JSON.parse(raw) as {
      statusAuthority: string;
      features: Array<Record<string, unknown>>;
    };

    // The exact value, not membership in a permitted set. The bootstrap
    // authority survived four features past its stated end because the audit
    // only ever checked that the value was one of two.
    expect(catalog.statusAuthority).toBe('protected_controller_state');

    // No mutable status anywhere in the catalog, by field and by byte.
    for (const feature of catalog.features) {
      expect(Object.keys(feature)).not.toContain('bootstrapStatus');
    }
    expect(raw).not.toContain('bootstrapStatus');
    expect(raw).not.toContain('bootstrap_git_until_el_02');

    // The schema refuses the drift rather than merely not exercising it.
    const schema = JSON.parse(
      await readFile(resolve('docs/product/engineering-loop/feature.schema.json'), 'utf8')
    ) as {
      properties: { statusAuthority: { const?: string; enum?: string[] } };
      $defs: { feature: { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> } };
    };
    expect(schema.properties.statusAuthority.const).toBe('protected_controller_state');
    expect(schema.properties.statusAuthority.enum).toBeUndefined();
    expect(schema.$defs.feature.required).not.toContain('bootstrapStatus');
    expect(Object.keys(schema.$defs.feature.properties)).not.toContain('bootstrapStatus');
    expect(schema.$defs.feature.additionalProperties).toBe(false);
  });

  it('links each requirement to nonempty source and deterministic test evidence', () => {
    for (const evidence of EL02_REQUIREMENT_EVIDENCE) {
      expect(evidence.source.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.source.every(path => path.endsWith('.ts'))).toBe(true);
      expect(evidence.tests.every(test => test.includes(':'))).toBe(true);
    }
  });

  it('audits catalog identifiers, order, dependencies, acceptance IDs, and accepted bootstrap prerequisites', async () => {
    const catalog = JSON.parse(
      await readFile(resolve('docs/product/engineering-loop/features.json'), 'utf8')
    ) as {
      statusAuthority: string;
      features: Array<{
        id: string;
        order: number;
        dependencies: string[];
        acceptance: Array<{ id: string }>;
      }>;
    };
    const ids = catalog.features.map(feature => feature.id);
    const idSet = new Set(ids);
    expect(idSet.size).toBe(ids.length);
    expect(catalog.features.map(feature => feature.order)).toEqual(
      catalog.features.map((_feature, index) => index)
    );
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const byId = new Map(catalog.features.map(feature => [feature.id, feature]));
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error(`catalog dependency cycle at ${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      const feature = byId.get(id);
      if (!feature) throw new Error(`missing catalog feature ${id}`);
      for (const dependency of feature.dependencies) {
        expect(idSet.has(dependency), `${id} dependency ${dependency}`).toBe(true);
        expect((byId.get(dependency) as typeof feature).order, `${id} dependency order`).toBeLessThan(feature.order);
        visit(dependency);
      }
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of ids) visit(id);
    expect(visited.size).toBe(catalog.features.length);
    const acceptanceIds = catalog.features.flatMap(feature => feature.acceptance.map(item => item.id));
    expect(new Set(acceptanceIds).size).toBe(acceptanceIds.length);
    for (const feature of catalog.features) {
      expect(feature.acceptance.every(item => item.id.startsWith(`${feature.id}-A`))).toBe(true);
    }
    // Dependency shape is an immutable catalog fact and stays here. The
    // accepted-prerequisite assertions that used to live alongside it moved to
    // the ledger tests: status is no longer the catalog's to state.
    expect(byId.get('EL-02')?.dependencies).toEqual(['EL-01']);
    expect(byId.get('EL-03')?.dependencies).toEqual(['EL-02']);
    expect(byId.get('EL-04')?.dependencies).toEqual(['EL-01', 'EL-02']);
    expect(byId.get('EL-05')?.dependencies).toEqual(['EL-02', 'EL-04']);
    expect(byId.get('EL-06')?.dependencies).toEqual(['EL-03', 'EL-04', 'EL-05']);
  });
});
