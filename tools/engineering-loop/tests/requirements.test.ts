import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EL02_REQUIREMENT_EVIDENCE,
  EL03_REQUIREMENT_EVIDENCE,
  EL04_REQUIREMENT_EVIDENCE,
  EL05_REQUIREMENT_EVIDENCE,
  EL06_REQUIREMENT_EVIDENCE,
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
        bootstrapStatus: string;
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
    expect(byId.get('EL-01')?.bootstrapStatus).toBe('accepted');
    expect(byId.get('EL-02')?.dependencies).toEqual(['EL-01']);
    expect(byId.get('EL-02')?.bootstrapStatus).toBe('accepted');
    expect(byId.get('EL-03')?.dependencies).toEqual(['EL-02']);
    expect(byId.get('EL-03')?.bootstrapStatus).toBe('accepted');
    expect(byId.get('EL-04')?.dependencies).toEqual(['EL-01', 'EL-02']);
    expect(byId.get('EL-04')?.bootstrapStatus).toBe('accepted');
    expect(byId.get('EL-04')?.dependencies.every(id => byId.get(id)?.bootstrapStatus === 'accepted')).toBe(true);
    expect(byId.get('EL-05')?.dependencies).toEqual(['EL-02', 'EL-04']);
    expect(byId.get('EL-05')?.bootstrapStatus).toBe('accepted');
    expect(byId.get('EL-05')?.dependencies.every(id => byId.get(id)?.bootstrapStatus === 'accepted')).toBe(true);
    expect(byId.get('EL-06')?.dependencies).toEqual(['EL-03', 'EL-04', 'EL-05']);
    expect(byId.get('EL-06')?.dependencies.every(id => byId.get(id)?.bootstrapStatus === 'accepted')).toBe(true);
    expect(['bootstrap_git_until_el_02', 'protected_controller_state']).toContain(catalog.statusAuthority);
  });
});
