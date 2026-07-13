import * as fs from 'fs';
import { neo4jDriver, pgPool } from '../src/config/db';
import { mulberry32 } from '../src/core/graph/verification';
import {
  defaultEntailmentPolicy,
  selectInsightEdges,
  sampleEntailmentPairs,
  detectUnsupportedCitations,
  makeOpenAIEntailmentJudge,
  makeOracleEntailmentJudge,
  EntailmentJudge
} from '../src/core/graph/entailment_detection';
import { verificationQueue } from '../src/workers/queue';

// Session 32 (PROVENANCE_THREADING.md §5.4): the entailment-detector sweep
// scheduler (npm run entailment:sweep).
//
// Samples unchecked DERIVED_INSIGHT (edge, cited-hash) pairs at an
// operator-visible rate under a per-sweep judge budget and either enqueues
// the batch for the verification worker (default, job name
// 'entailment_sweep') or judges it in-process (--sync). A sampled DETECTOR,
// never a gate: unsupported pairs contest the edge through the ordinary
// belief machinery (contestedReason = 'unsupported_citation'); recovery is
// re-derivation. A real (non-oracle) sweep spends one judge completion per
// pair — owner-gated, propose with the --dry-run selection count first.
//
// Flags:
//   --rate <p>     pair sampling rate (default config ENTAILMENT_SAMPLE_RATE)
//   --budget <n>   judge-call cap per sweep (default config ENTAILMENT_JUDGE_BUDGET_PER_SWEEP)
//   --seed <n>     deterministic sampling RNG
//   --prefix <s>   subject-name prefix filter (hermetic tests)
//   --oracle <path> LLM-free dress rehearsal: JSON entailmentPairKey->boolean map
//   --sync         judge in-process instead of enqueueing
//   --dry-run      print the selection and exit without judging

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const seed = getFlag('seed');
  const policy = defaultEntailmentPolicy({
    sampleRate: getFlag('rate') ? Number(getFlag('rate')) : undefined,
    judgeBudget: getFlag('budget') ? Number(getFlag('budget')) : undefined,
    random: seed ? mulberry32(Number(seed)) : undefined,
    subjectPrefix: getFlag('prefix')
  });
  const policyLabel = `rate=${policy.sampleRate}, budget=${policy.judgeBudget}`;

  const edges = await selectInsightEdges(neo4jDriver, policy);
  const selection = sampleEntailmentPairs(edges, policy);
  console.log(`Entailment sweep [${policyLabel}]`);
  console.log(`  edge pool:   ${selection.poolEdges} edge(s), ${selection.poolPairs} unchecked pair(s)`);
  console.log(`  sampled:     ${selection.sampled} (${selection.pairs.length} within budget, ${selection.deferred} deferred)`);

  if (hasFlag('dry-run')) {
    for (const p of selection.pairs) {
      console.log(`    ${p.subject} ${p.verb} ${p.object} <- ${p.hash}`);
    }
    return;
  }

  const oraclePath = getFlag('oracle');
  const oracle: Record<string, boolean> | undefined =
    oraclePath ? JSON.parse(fs.readFileSync(oraclePath, 'utf-8')) : undefined;

  if (hasFlag('sync')) {
    const judge: EntailmentJudge = oracle ? makeOracleEntailmentJudge(oracle) : makeOpenAIEntailmentJudge();
    const report = await detectUnsupportedCitations(neo4jDriver, pgPool, selection.pairs, judge);
    console.log(`  judged ${report.judged}: ${report.supported} supported, ${report.flagged} flagged (${report.edgesFlagged} edge(s) contested), ${report.skippedNoText} skipped (no live text), ${report.skippedNoAnswer} skipped (no answer), ${report.usage.subcalls} sub-call(s)`);
    for (const f of report.flags) {
      console.log(`    FLAGGED ${f.subject} ${f.verb} ${f.object}: cited ${f.hash} does not support the claim — contested.`);
    }
    return;
  }

  const job = await verificationQueue.add('entailment_sweep', {
    pairs: selection.pairs,
    oracle,
    policyLabel
  });
  console.log(`  enqueued job ${job.id} on verification_queue (${selection.pairs.length} pair(s)) — start the verification worker to process it.`);
}

main()
  .then(async () => {
    await neo4jDriver.close();
    await pgPool.end();
    await verificationQueue.close();
    process.exit(0);
  })
  .catch(async err => {
    console.error(`Sweep error: ${err.stack ?? err.message}`);
    try { await neo4jDriver.close(); await pgPool.end(); await verificationQueue.close(); } catch {}
    process.exit(1);
  });
