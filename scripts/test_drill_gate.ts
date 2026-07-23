/**
 * Drill-target gate drill.
 *
 * Specification: src/core/runtime/drill_target.ts (the two gates: a
 * database-resident target marker, and a per-act confirmation flag).
 * Entrypoint: `npm run test:drill-gate` (the non-test caller, AGENTS.md
 * rule 15).
 *
 * Modes:
 *   default              run sections; exit 0 iff all green
 *   --negative-control   plant four breaks that MUST be refused; healthy
 *                        behavior is detection: exit 3 with all four
 *                        named. Exit 1 (a break was absorbed — the gate
 *                        let it through) means the gate is broken.
 *
 * Why this exists: AGENTS.md rule 19(c) — a check earns the name
 * `verification` by having been seen to fail. A drill gate that has
 * never been observed refusing is indistinguishable from a gate that
 * silently passes everything, and the failure it is supposed to prevent
 * (a drill flipping beliefs in a database holding real work) is not one
 * you get to discover twice.
 *
 * Zero paid work, zero database: the gate takes its marker readers as
 * injected dependencies, so every refusal path runs against fakes.
 */

import {
  ConfirmationRefusal,
  DrillTargetRefusal,
  assertConfirmed,
  assertDrillTarget,
  describeTargets,
  reportRefusal,
  type DrillTargetMarker,
  type MarkerReaders,
} from '../src/core/runtime/drill_target';

const negativeControl = process.argv.includes('--negative-control');

const MARKER: DrillTargetMarker = {
  purpose: 'scratch benchmark stack',
  markedAt: '2026-07-23T00:00:00.000Z',
  markedBy: 'drill',
};

const marked: MarkerReaders = {
  neo4j: async () => MARKER,
  postgres: async () => MARKER,
};
const unmarked: MarkerReaders = {
  neo4j: async () => null,
  postgres: async () => null,
};

interface Finding { scenario: string; expected: string; observed: string }

const findings: Finding[] = [];
let checks = 0;

function expect(scenario: string, expected: string, observed: string): void {
  checks += 1;
  if (expected !== observed) findings.push({ scenario, expected, observed });
}

/** Runs `act`, returning the refusal's class name, or 'no-refusal'. */
async function refusalOf(act: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await act();
    return 'no-refusal';
  } catch (error) {
    return error instanceof Error ? error.constructor.name : 'non-error-throw';
  }
}

async function runSections(): Promise<void> {
  // ---------- the marker gate ----------
  expect(
    'a fully marked target passes both stores',
    'no-refusal',
    await refusalOf(() => assertDrillTarget(['neo4j', 'postgres'], marked))
  );
  expect(
    'an unmarked graph is refused',
    'DrillTargetRefusal',
    await refusalOf(() => assertDrillTarget(['neo4j'], unmarked))
  );
  expect(
    'an unmarked registry is refused',
    'DrillTargetRefusal',
    await refusalOf(() => assertDrillTarget(['postgres'], unmarked))
  );
  expect(
    'a marked graph does not vouch for an unmarked registry',
    'DrillTargetRefusal',
    await refusalOf(() => assertDrillTarget(['neo4j', 'postgres'], {
      neo4j: async () => MARKER,
      postgres: async () => null,
    }))
  );

  // ---------- the confirmation gate ----------
  expect(
    'an unconfirmed destructive act is refused',
    'ConfirmationRefusal',
    await refusalOf(() => assertConfirmed({ confirmed: false, flag: '--confirm-reset', act: 'x' }))
  );
  expect(
    'a confirmed act proceeds',
    'no-refusal',
    await refusalOf(() => assertConfirmed({ confirmed: true, flag: '--confirm-reset', act: 'x' }))
  );

  // ---------- refusals are actionable ----------
  const refusal = await assertDrillTarget(['neo4j'], unmarked)
    .then(() => null)
    .catch((e: unknown) => e as DrillTargetRefusal);
  expect(
    'the refusal names the resolved target so a wrong host is visible',
    'names-target',
    refusal?.message.includes(describeTargets().neo4j) ? 'names-target' : 'hides-target'
  );
  expect(
    'the refusal names the command that would authorize the run',
    'names-command',
    refusal?.message.includes('npm run drill:mark-target') ? 'names-command' : 'no-command'
  );

  // ---------- exit-code mapping ----------
  // reportRefusal prints the refusal it classifies; silence it here so
  // the section's own output stays readable.
  const realError = console.error;
  console.error = () => {};
  try {
    expect(
      'a target refusal maps to exit 2',
      '2',
      String(reportRefusal(new DrillTargetRefusal('neo4j', 'x')))
    );
    expect(
      'a confirmation refusal maps to exit 2',
      '2',
      String(reportRefusal(new ConfirmationRefusal('--confirm-reset', 'x')))
    );
    expect(
      'an ordinary failure is passed through with its stack',
      'null',
      String(reportRefusal(new Error('connection reset')))
    );
  } finally {
    console.error = realError;
  }
}

/**
 * Four planted breaks, each a way a real drill could reach a wrong
 * database. Healthy behavior is that every one of them is REFUSED.
 */
async function runNegativeControl(): Promise<number> {
  const detections: Array<[string, boolean]> = [];

  // A: the operator is pointed at a database nobody ever declared
  // expendable — the stale-.env case.
  detections.push([
    'A: drill against a wholly unmarked stack',
    await refusalOf(() => assertDrillTarget(['neo4j', 'postgres'], unmarked)) === 'DrillTargetRefusal',
  ]);

  // B: the graph is a known drill target but the registry is a different,
  // unmarked host — a half-configured environment.
  detections.push([
    'B: drill against a marked graph and an unmarked registry',
    await refusalOf(() => assertDrillTarget(['neo4j', 'postgres'], {
      neo4j: async () => MARKER,
      postgres: async () => null,
    })) === 'DrillTargetRefusal',
  ]);

  // C: a correctly marked target, but the destructive act was never
  // confirmed — the fat-fingered re-run of a shell-history line.
  detections.push([
    'C: destructive act on a marked target without its --confirm flag',
    await refusalOf(async () => {
      await assertDrillTarget(['neo4j'], marked);
      assertConfirmed({ confirmed: false, flag: '--confirm-strip', act: 'unscoped delete' });
    }) === 'ConfirmationRefusal',
  ]);

  // D: a marker reader that throws (an unreachable or auth-failed store)
  // must not be read as "marked" — absence of a NO is not a YES.
  detections.push([
    'D: an erroring marker reader does not pass as marked',
    await refusalOf(() => assertDrillTarget(['neo4j'], {
      neo4j: async () => { throw new Error('Neo.ClientError.Security.Unauthorized'); },
      postgres: async () => null,
    })) !== 'no-refusal',
  ]);

  console.log('Negative control — four planted breaks, each MUST be refused:\n');
  for (const [name, detected] of detections) {
    console.log(`  ${detected ? 'REFUSED (healthy)' : 'ABSORBED (BROKEN)'}  ${name}`);
  }

  const absorbed = detections.filter(([, detected]) => !detected);
  if (absorbed.length === 0) {
    console.log('\nAll four breaks were refused. The gate can fail, so its passes carry information.');
    console.log('Exit 3 (negative control healthy).');
    return 3;
  }
  console.error(`\n${absorbed.length} of 4 planted breaks were ABSORBED by the gate:`);
  for (const [name] of absorbed) console.error(`  ${name}`);
  console.error('\nThe gate does not refuse what it claims to refuse. Exit 1.');
  return 1;
}

async function main(): Promise<number> {
  if (negativeControl) return runNegativeControl();

  await runSections();
  if (findings.length === 0) {
    console.log(`Drill-target gate: ${checks} checks green.`);
    console.log('\nProve the gate can refuse:  npm run test:drill-gate -- --negative-control');
    return 0;
  }
  console.error(`Drill-target gate: ${findings.length} of ${checks} checks FAILED.`);
  for (const finding of findings) {
    console.error(`  ${finding.scenario}`);
    console.error(`    expected ${finding.expected}, observed ${finding.observed}`);
  }
  return 1;
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    console.error(`Drill-gate harness crashed: ${error instanceof Error ? error.stack : error}`);
    process.exit(1);
  });
