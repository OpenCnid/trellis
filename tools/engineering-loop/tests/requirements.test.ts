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
  EL11_REQUIREMENT_EVIDENCE,
} from '../src/requirements';
import { analyzeConformanceLinkage, analyzeProducerReachability } from '../src/conformance';
import { buildAcceptanceChangeRequest } from '../src/acceptance_change';
import { protectedRequestDigest } from '../src/policy';

const SOURCE_ROOT = 'tools/engineering-loop/src';

function requirementIds(spec: string, feature: string): string[] {
  return [...spec.matchAll(new RegExp(`^\\| \`(EL-REQ-[A-Z]+-\\d{3})\` \\| \`${feature}\` \\|`, 'gm'))]
    .map(match => match[1])
    .sort();
}

/**
 * Reads the real package scripts and the real source tree, and resolves which
 * producers a package script can actually reach. The inputs are gathered here and
 * the analysis stays pure, so the check itself can be falsified against fixtures
 * without breaking the repository.
 */
async function reachability() {
  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const directory = resolve(SOURCE_ROOT);
  const modules = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => entry.name);
  const sources: Record<string, string> = {};
  for (const module of modules) {
    sources[module] = await readFile(resolve(directory, module), 'utf8');
  }
  return analyzeProducerReachability({ scripts: packageJson.scripts, sources, sourceRoot: SOURCE_ROOT });
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
    // machine-checkable and is checked here. EL-11 follows the same convention
    // and is checked by its own resolution test.
    //
    // EL-02 through EL-06 are deliberately not widened into this check, recorded
    // here rather than left to be rediscovered. Their evidence uses a
    // human-readable `module: concept` pointer that resolves to nothing
    // mechanically, so a stale one cannot be caught — the same unenforced-claim
    // shape this feature exists to close, and worth fixing. It is not fixed here
    // because those five features are owner-accepted: rewriting their evidence
    // lists is churn against accepted work, it would move EL-06's pinned 36-row
    // set, and EL-REQ-APPROVAL-007 makes changing accepted acceptance a named
    // reviewed feature rather than something EL-11 does in passing. Sequencing it
    // is the owner's call.
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

  it('independently computes and pins every and only EL-11-owned conformance row', async () => {
    const spec = await readFile(resolve('tools/engineering-loop/SPEC.md'), 'utf8');
    const computed = requirementIds(spec, 'EL-11');
    expect(computed).toEqual([
      'EL-REQ-APPROVAL-010',
      'EL-REQ-APPROVAL-012',
      'EL-REQ-BOOT-008',
    ]);
    const mapped = EL11_REQUIREMENT_EVIDENCE.map(item => item.requirement).sort();
    expect(computed).toHaveLength(3);
    expect(new Set(mapped).size).toBe(3);
    expect(mapped).toEqual(computed);
  });

  it('links all three EL-11 rows to concrete TypeScript sources and deterministic named tests', async () => {
    for (const evidence of EL11_REQUIREMENT_EVIDENCE) {
      expect(evidence.source.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.length, evidence.requirement).toBeGreaterThan(0);
      expect(evidence.tests.every(test => test.includes(':'))).toBe(true);
      for (const source of evidence.source) {
        expect(source.endsWith('.ts')).toBe(true);
        await expect(readFile(resolve('tools/engineering-loop/src', source), 'utf8')).resolves.not.toHaveLength(0);
      }
    }
  });

  it('resolves every EL-11 named test to a real test that exists', async () => {
    // EL-11 follows EL-10's literal `it(...)` convention rather than EL-02
    // through EL-06's `module: concept` pointers, so the claim that a requirement
    // is deterministically verified is machine-checkable instead of resting on
    // author care.
    const directory = resolve('tools/engineering-loop/tests');
    const corpus = (await Promise.all(
      (await readdir(directory))
        .filter(file => file.endsWith('.test.ts'))
        .map(file => readFile(resolve(directory, file), 'utf8'))
    )).join('\n');
    for (const evidence of EL11_REQUIREMENT_EVIDENCE) {
      for (const test of evidence.tests) {
        expect(corpus, `${evidence.requirement} names '${test}', which resolves to no test`).toContain(`it('${test}'`);
      }
    }
  });

  it('EL-11-A3: every declared requirement carries a conformance row and every row has declaring text', async () => {
    // EL-01-A2 has been a catalog acceptance criterion since EL-01 and had never
    // been mechanized. EL-REQ-APPROVAL-012 landed declared and unmapped — 114
    // declared, 113 mapped — and nothing failed, because nothing could. This is
    // the check whose absence let that happen.
    const spec = await readFile(resolve('tools/engineering-loop/SPEC.md'), 'utf8');
    const linkage = analyzeConformanceLinkage(spec);

    expect(linkage.unmapped).toEqual([]);
    expect(linkage.undeclared).toEqual([]);
    expect(linkage.duplicateDeclarations).toEqual([]);
    expect(linkage.duplicateRows).toEqual([]);
    expect(linkage.declared).toHaveLength(linkage.mapped.length);

    // Every row names a real catalog feature and one of that feature's own
    // acceptance items, so a row cannot point at a feature or criterion that does
    // not exist.
    const catalog = JSON.parse(
      await readFile(resolve('docs/product/engineering-loop/features.json'), 'utf8')
    ) as { features: Array<{ id: string; acceptance: Array<{ id: string }> }> };
    const acceptanceIds = new Set(catalog.features.flatMap(feature => feature.acceptance.map(item => item.id)));
    const featureIds = new Set(catalog.features.map(feature => feature.id));
    for (const row of linkage.mapped) {
      expect(featureIds.has(row.owningFeature), `${row.id} owner ${row.owningFeature}`).toBe(true);
      expect(acceptanceIds.has(row.catalogAcceptance), `${row.id} acceptance ${row.catalogAcceptance}`).toBe(true);
      expect(row.catalogAcceptance.startsWith(`${row.owningFeature}-A`), `${row.id} acceptance owner`).toBe(true);
      expect(['static', 'integration', 'review', 'measurement']).toContain(row.plannedClass);
    }
  });

  it('EL-11-A3: the linkage check fails on a declared requirement with no row', () => {
    // The negative control. A check nobody has watched fail is an invariant
    // asserted rather than enforced, which is the defect this feature closes.
    const orphan = [
      '## 12. Approvals',
      '',
      '| ID | Requirement |',
      '|---|---|',
      '| `EL-REQ-FAKE-001` | Mapped requirement text. |',
      '| `EL-REQ-FAKE-002` | Declared and never mapped, exactly as APPROVAL-012 was. |',
      '',
      '## 18. Conformance matrix',
      '',
      '| Requirement | Owning feature | Catalog acceptance | Planned class |',
      '|---|---|---|---|',
      '| `EL-REQ-FAKE-001` | `EL-01` | `EL-01-A1` | review |',
      '',
      '## 19. Deferred',
    ].join('\n');
    expect(analyzeConformanceLinkage(orphan).unmapped).toEqual(['EL-REQ-FAKE-002']);

    // And on a row that maps a requirement no section declares.
    const ghost = [
      '## 12. Approvals',
      '',
      '| ID | Requirement |',
      '|---|---|',
      '| `EL-REQ-FAKE-001` | Mapped requirement text. |',
      '',
      '## 18. Conformance matrix',
      '',
      '| Requirement | Owning feature | Catalog acceptance | Planned class |',
      '|---|---|---|---|',
      '| `EL-REQ-FAKE-001` | `EL-01` | `EL-01-A1` | review |',
      '| `EL-REQ-FAKE-009` | `EL-01` | `EL-01-A1` | review |',
      '',
      '## 19. Deferred',
    ].join('\n');
    expect(analyzeConformanceLinkage(ghost).undeclared).toEqual(['EL-REQ-FAKE-009']);

    // The backtick trap, pinned: requirement text beginning with a literal rather
    // than a capital is declared, not an orphan. A naive pattern reports a false
    // alarm here, and a false alarm costs more than the check saves.
    const backtick = [
      '## 5. State',
      '',
      '| ID | Requirement |',
      '|---|---|',
      '| `EL-REQ-FAKE-010` | `accepted` MUST require satisfied dependencies. |',
      '',
      '## 18. Conformance matrix',
      '',
      '| Requirement | Owning feature | Catalog acceptance | Planned class |',
      '|---|---|---|---|',
      '| `EL-REQ-FAKE-010` | `EL-01` | `EL-01-A1` | review |',
      '',
      '## 19. Deferred',
    ].join('\n');
    const analyzed = analyzeConformanceLinkage(backtick);
    expect(analyzed.unmapped).toEqual([]);
    expect(analyzed.declared.map(item => item.id)).toEqual(['EL-REQ-FAKE-010']);
  });

  it('requirements: every computed-material producer resolves a non-test caller', async () => {
    const report = await reachability();

    // The entrypoint is derived from package.json, never declared by the check:
    // a producer cannot be made reachable by adding a row to a table.
    expect(report.entrypoints).toContain('activate.ts');

    // EL-11's own protected action is reachable. The steady-state acceptance
    // change would otherwise be a path whose approval nobody could authorize,
    // which is the defect this requirement exists to refuse.
    const steadyState = report.producers.find(producer => producer.ceremony === 'steady_state_acceptance');
    expect(steadyState?.reachable, 'steady_state_acceptance producer').toBe(true);
    expect(steadyState?.callers).toContain('activate.ts');

    const seeding = report.producers.find(producer => producer.ceremony === 'seeding');
    expect(seeding?.reachable, 'seeding producer').toBe(true);

    // OPEN DEFECT, pinned rather than hidden. Both EL-10 recovery ceremonies are
    // implemented and tested and have no caller outside tests/, so an owner facing
    // a corrupt ledger still has no route but hand-editing the protected file —
    // the untrusted-side write the ceremonies exist to eliminate. Under
    // EL-REQ-APPROVAL-010 that is EL-10 failing acceptance as unreachable, and it
    // is the owner's to sequence; EL-11 reports it rather than building EL-10's
    // CLI unbidden.
    //
    // This pin is not an exemption a human must remember to clear: reachability is
    // re-derived from the import graph every run, and wiring either ceremony to an
    // entrypoint turns this assertion red in the same commit that fixes it, which
    // is when it should be recomputed wittingly.
    expect(report.unreachable.map(producer => producer.ceremony).sort())
      .toEqual(['ledger_recovery', 're_genesis']);
    for (const producer of report.unreachable) {
      expect(producer.owningFeature, `${producer.ceremony} is EL-10's to fix`).toBe('EL-10');
      expect(producer.callers).toEqual([]);
    }
  });

  it('requirements: the reachability check fails when an entrypoint stops producing the material', () => {
    // The negative control, run against fixtures rather than the real tree so the
    // red is observable without breaking the repository.
    const producers = [{
      ceremony: 'steady_state_acceptance',
      action: 'acceptance_change',
      owningFeature: 'EL-11',
      material: 'acceptance change request digest',
      requestBuilder: 'buildAcceptanceChangeRequest',
      module: 'acceptance_change.ts',
    }];
    const sourceRoot = 'tools/engineering-loop/src';
    const scripts = { 'el:activate': `tsx ${sourceRoot}/activate.ts` };

    const wired = analyzeProducerReachability({
      scripts,
      sourceRoot,
      producers,
      sources: {
        'activate.ts': "import { buildAcceptanceChangeRequest } from './acceptance_change.js';\nbuildAcceptanceChangeRequest({});",
        'acceptance_change.ts': 'export function buildAcceptanceChangeRequest() {}',
      },
    });
    expect(wired.unreachable).toEqual([]);
    expect(wired.producers[0].callers).toEqual(['activate.ts']);

    // Remove the entrypoint's call and the producer is unreachable: authorizing
    // material with no way for a principal to obtain it.
    const orphaned = analyzeProducerReachability({
      scripts,
      sourceRoot,
      producers,
      sources: {
        'activate.ts': "import { readCatalog } from './catalog.js';",
        'acceptance_change.ts': 'export function buildAcceptanceChangeRequest() {}',
      },
    });
    expect(orphaned.unreachable.map(producer => producer.ceremony)).toEqual(['steady_state_acceptance']);

    // A caller that is only a test does not count: the module is not reachable
    // from any package script, so it never enters the graph.
    const testOnly = analyzeProducerReachability({
      scripts: {},
      sourceRoot,
      producers,
      sources: { 'acceptance_change.ts': 'export function buildAcceptanceChangeRequest() {}' },
    });
    expect(testOnly.entrypoints).toEqual([]);
    expect(testOnly.unreachable.map(producer => producer.ceremony)).toEqual(['steady_state_acceptance']);
  });

  it('requirements: the controller fully specifies a protected request before any approval exists', async () => {
    // EL-REQ-APPROVAL-012: the pause gates the protected effect only. It must not
    // be used to withhold preparatory work pending approval, so the controller
    // composes the complete request — typed action, exact scope, computed
    // material, preconditions — with an empty channel and no approval anywhere.
    const request = buildAcceptanceChangeRequest({
      pairs: [{ featureId: 'EL-10', status: 'accepted' }, { featureId: 'EL-07', status: 'planned' }],
      repository: {
        repositoryId: 'repo:trellis',
        worktreeId: 'worktree:el11',
        branch: 'implement-el11-approval-reachability',
        baseCommit: '272a18eceb078650b96800faa4faea7e2ac532ce',
        headCommit: '272a18eceb078650b96800faa4faea7e2ac532ce',
        clean: true,
      },
      createdAt: '2026-07-15T10:00:00.000Z',
      approvalId: 'approval:does-not-exist-anywhere',
    });

    // Typed action, exact scope, preconditions, and computed material, all present
    // without a single channel read.
    expect(request.action).toBe('acceptance_change');
    expect(request.exactScope).toEqual(['EL-07=planned', 'EL-10=accepted']);
    expect(request.repositoryPrecondition.headCommit).toBe('272a18eceb078650b96800faa4faea7e2ac532ce');
    expect(protectedRequestDigest(request)).toMatch(/^[0-9a-f]{64}$/);

    // The request names an approval that does not exist and is still fully
    // specified: specificity is the controller's burden and it is discharged
    // before, not after, the owner decides.
    expect(request.approvalId).toBe('approval:does-not-exist-anywhere');

    // And the entrypoint exposes it as its own command, so the preparatory work is
    // something a principal can actually ask for.
    const activate = await readFile(resolve('tools/engineering-loop/src/activate.ts'), 'utf8');
    expect(activate).toContain("'print-acceptance-request'");
    expect(activate).toContain('printAcceptanceChangeRequest');
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
