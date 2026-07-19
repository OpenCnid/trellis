import { pgPool, neo4jDriver } from '../src/config/db';
import { SUPPORT_PARAMS_V1 } from '../src/core/graph/support';
import {
  createPgConvocationStore,
  replayConvocationRecords,
} from '../src/core/graph/judge_convocation_store';
import { fetchJudgeEntityStates } from '../src/core/graph/judge_registration';
import { computeConvocationReport } from '../src/core/graph/support_sweep';

// The read-time report (JUDGE_CONVOCATION_DESIGN.md §3.2): verdict
// records replayed through composePanel → computeSupportOpinion at
// read time. ADVISORY ONLY — this surface informs the WORKSPACE §6
// operator promotion ceremony and the batch-ratification queue; it
// gates nothing, writes nothing, and no RLM surface can reach it
// (EPISTEMIC_SUPPORT §6; AB-5).
//
//   npm run support:report

async function main(): Promise<number> {
  const store = createPgConvocationStore(pgPool);
  const state = replayConvocationRecords(await store.loadAll());
  const graphStates = await fetchJudgeEntityStates(neo4jDriver);
  const asOf = Date.now();
  const reports = computeConvocationReport(state, graphStates, asOf, SUPPORT_PARAMS_V1);

  console.log(`Convocation report (asOf ${new Date(asOf).toISOString()}; opinions computed at read time, never stored)`);
  console.log(`Candidates: ${reports.length}; stored verdicts: ${state.verdicts.length}; runs: ${state.runReports.size}`);
  for (const r of reports) {
    console.log(`\n  ${r.selectionId}  (mode ${r.claimMode}, ${r.verdicts} verdict(s))`);
    if (r.refusal !== null) {
      console.log(`    COMPOSITION REFUSED: ${r.refusal}`);
      continue;
    }
    if (r.composition === null) continue;
    const { opinion, conflicts, disagreements, exclusions, counts } = r.composition;
    console.log(`    opinion: b=${opinion.b.toFixed(4)} d=${opinion.d.toFixed(4)} u=${opinion.u.toFixed(4)} projected=${opinion.projected.toFixed(4)}`);
    console.log(`    counts: consumed=${counts.verdictsConsumed} withheld=${counts.verdictsWithheld} jurisdictionAbstains=${counts.jurisdictionAbstains}`);
    for (const c of conflicts) console.log(`    NO-GLOBAL-SECTION on ${c.parameter}: ${c.judges.map((j) => `${j.judgeId}=${j.verdict}`).join(' vs ')}`);
    for (const d of disagreements) console.log(`    cross-role disagreement on ${d.registryEntry}: ${d.judges.map((j) => `${j.judgeId}=${j.verdict}`).join(' vs ')}`);
    for (const e of exclusions) console.log(`    excluded: ${e.judgeId} (${e.assumption} negated)`);
  }

  // Rule 12: designed silence disclosed — the per-run counts.
  for (const [runId, report] of state.runReports.entries()) {
    const r = report as { exclusions?: unknown[]; jurisdictionAbstains?: number; deferred?: number; skippedNoAnswer?: number };
    console.log(`\n  run ${runId}: exclusions=${r.exclusions?.length ?? 0} jurisdictionAbstains=${r.jurisdictionAbstains ?? 0} deferred=${r.deferred ?? 0} skipped=${r.skippedNoAnswer ?? 0}`);
  }
  return 0;
}

main()
  .then(async (code) => {
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(`\nsupport_report failed: ${error instanceof Error ? error.message : error}`);
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(1);
  });
