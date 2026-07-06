import * as fs from 'fs';
import { neo4jDriver, pgPool } from '../src/config/db';
import { config } from '../src/config/index';
import {
  selectResolutionCandidates,
  resolveCandidatePairs,
  makeOpenAIAdjudicator,
  makeOracleAdjudicator,
  Adjudicator,
} from '../src/core/graph/alias_resolution';
import { resolutionQueue } from '../src/workers/queue';

// Session 5: the entity-resolution sweep scheduler (npm run resolve:sweep).
//
// Reads resolvable entities from Neo4j (uncontested, kinds
// generic/concept, live provenance), generates deterministic lexical
// candidate pairs, excludes pairs already settled by a non-contested
// SAME_AS / DISTINCT_FROM verdict, caps the batch, and either enqueues
// it for the resolution worker (default) or adjudicates in-process
// (--sync). Same shape as scripts/verify_sweep.ts.
//
// Flags:
//   --max-pairs <n>   batch cap (default RESOLUTION_MAX_PAIRS_PER_SWEEP)
//   --prefix <s>      only consider entities whose name starts with s
//                     (used by hermetic drills)
//   --oracle <path>   LLM-free dress rehearsal: JSON pairId -> boolean map
//   --sync            adjudicate in-process instead of enqueueing
//   --dry-run         print the candidate pairs and exit

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const maxPairs = getFlag('max-pairs')
    ? Number(getFlag('max-pairs'))
    : config.resolution.maxPairsPerSweep;
  const namePrefix = getFlag('prefix');
  const policyLabel = `max=${maxPairs}${namePrefix ? `, prefix=${namePrefix}` : ''}`;

  const selection = await selectResolutionCandidates(neo4jDriver, { maxPairs, namePrefix });
  console.log(`Resolution sweep [${policyLabel}]`);
  console.log(`  entity pool:       ${selection.poolSize}`);
  console.log(`  settled (skipped): ${selection.excludedExisting}`);
  console.log(`  candidate pairs:   ${selection.pairs.length}`);

  if (hasFlag('dry-run')) {
    for (const pair of selection.pairs) {
      console.log(`    [${pair.signal}] ${pair.a.name} <-> ${pair.b.name}`);
    }
    return;
  }

  const oraclePath = getFlag('oracle');
  const oracle: Record<string, boolean> | undefined = oraclePath
    ? JSON.parse(fs.readFileSync(oraclePath, 'utf-8'))
    : undefined;

  if (hasFlag('sync')) {
    const adjudicator: Adjudicator = oracle ? makeOracleAdjudicator(oracle) : makeOpenAIAdjudicator();
    const report = await resolveCandidatePairs(neo4jDriver, pgPool, selection.pairs, adjudicator, {
      method: oracle ? 'oracle' : 'llm',
      model: oracle ? null : config.llm.extractionModel,
    });
    console.log(`  adjudicated ${report.adjudicated}: ${report.same} same, ${report.distinct} distinct, ${report.skippedNoText} skipped (no live text), ${report.usage.subcalls} sub-call(s)`);
    for (const alias of report.aliases) {
      console.log(`    SAME_AS ${alias.aName} <-> ${alias.bName} (confidence=${alias.confidence}, signal=${alias.signal})`);
    }
    return;
  }

  const job = await resolutionQueue.add('resolution_sweep', {
    pairs: selection.pairs,
    oracle,
    policyLabel,
  });
  console.log(`  enqueued job ${job.id} on resolution_queue (${selection.pairs.length} pair(s)) — start the resolution worker to process it.`);
}

main()
  .then(async () => {
    await neo4jDriver.close();
    await pgPool.end();
    await resolutionQueue.close();
    process.exit(0);
  })
  .catch(async err => {
    console.error(`Sweep error: ${err.stack ?? err.message}`);
    try { await neo4jDriver.close(); await pgPool.end(); await resolutionQueue.close(); } catch {}
    process.exit(1);
  });
