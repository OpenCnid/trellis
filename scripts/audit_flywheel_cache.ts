import { neo4jDriver } from '../src/config/db';
import { resolveDatasetPath, loadDataset } from '../src/benchmarks/oolong/dataset_cli';
import { auditFlywheelCache } from '../src/benchmarks/oolong/cache_audit';

// Audits the RLM's cached HAS_CATEGORY insights against the dataset's
// ground-truth labels — measures how trustworthy the flywheel cache is.
//
// Session 6: the audit arithmetic lives in the shared pure module
// src/benchmarks/oolong/cache_audit.ts (also consumed by the benchmark
// runner and the poison drill); this script is a thin caller. The
// fetch is scoped to the dataset's question ids and counts only
// EFFECTIVE (non-contested) beliefs — what the cache actually serves.
// `--dataset <path>` selects the corpus (default v1).

async function main(): Promise<void> {
  const datasetPath = resolveDatasetPath(process.argv.slice(2));
  const dataset = loadDataset(datasetPath);

  let audit;
  try {
    audit = await auditFlywheelCache(neo4jDriver, dataset);
  } finally {
    await neo4jDriver.close();
  }

  console.log(`Dataset: ${dataset.name} (${dataset.records.length} questions)`);
  console.log(`Cached has_category insights (effective): ${audit.cached}`);
  console.log(`  Correct: ${audit.correct}  Wrong: ${audit.wrong}  Unknown qid: ${audit.unknown}`);
  console.log(`  Accuracy: ${audit.accuracy === null ? 'n/a (cache empty)' : `${(audit.accuracy * 100).toFixed(1)}%`}`);
  if (audit.mistakes.length) {
    console.log('  Sample mistakes:');
    for (const m of audit.mistakes) console.log(`    ${m.qid}: cached=${m.cached} truth=${m.truth}`);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
