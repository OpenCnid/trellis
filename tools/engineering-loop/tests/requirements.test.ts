import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EL02_REQUIREMENT_EVIDENCE } from '../src/requirements';

function el02RequirementIds(spec: string): string[] {
  return [...spec.matchAll(/^\| `(EL-REQ-[A-Z]+-\d{3})` \| `EL-02` \|/gm)]
    .map(match => match[1])
    .sort();
}

describe('EL-02 normative linkage', () => {
  it('maps every and only EL-02-owned requirement in the SPEC conformance matrix', async () => {
    const spec = await readFile(resolve('tools/engineering-loop/SPEC.md'), 'utf8');
    const computed = el02RequirementIds(spec);
    const mapped = EL02_REQUIREMENT_EVIDENCE.map(item => item.requirement).sort();
    expect(computed).toHaveLength(28);
    expect(new Set(mapped).size).toBe(28);
    expect(mapped).toEqual(computed);
  });

  it('links each requirement to nonempty source and deterministic test evidence', () => {
    for (const evidence of EL02_REQUIREMENT_EVIDENCE) {
      expect(evidence.source.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.source.every(path => path.endsWith('.ts'))).toBe(true);
      expect(evidence.tests.every(test => test.includes(':'))).toBe(true);
    }
  });

  it('audits catalog identifiers, order, dependencies, acceptance IDs, and EL-02 bootstrap prerequisites', async () => {
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
    expect(['bootstrap_git_until_el_02', 'protected_controller_state']).toContain(catalog.statusAuthority);
  });
});
