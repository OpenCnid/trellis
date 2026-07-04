import * as fs from 'fs';
import { neo4jDriver, pgPool } from '../src/config/db';
import {
  defaultPolicy,
  mulberry32,
  selectVerificationCandidates,
  verifyBeliefs,
  makeOpenAIClassifier,
  makeOracleClassifier,
  Classifier
} from '../src/core/graph/verification';
import { verificationQueue } from '../src/workers/queue';

// Phase 5 Milestone 3: the sweep scheduler (npm run verify:sweep).
//
// Selects a policy-driven batch of cached has_category beliefs
// (mandatory tier: low/missing confidence or stale rubric; sampled tier
// at rate p; graduated tier at the rare spot-check rate) and either
// enqueues it for the verification worker (default) or verifies it
// in-process (--sync).
//
// Flags:
//   --rate <p>            sampled-tier rate (default 0.05)
//   --graduated-rate <p>  graduated spot-check rate (default rate/10)
//   --graduation <n>      verified_count graduation threshold (default 3)
//   --confidence-floor <c> mandatory below this confidence (default 0.8)
//   --seed <n>            deterministic sampling RNG
//   --oracle <path>       LLM-free dress rehearsal: JSON id->label map, or
//                         a dataset file with records[{id, category}]
//   --sync                verify in-process instead of enqueueing
//   --dry-run             print the selection and exit without verifying

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function loadOracle(file: string): Record<string, string> {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (Array.isArray(parsed.records)) {
    const truth: Record<string, string> = {};
    for (const rec of parsed.records) truth[rec.id] = String(rec.category).toLowerCase();
    return truth;
  }
  return parsed;
}

async function main(): Promise<void> {
  const seed = getFlag('seed');
  const policy = defaultPolicy({
    sampleRate: getFlag('rate') ? Number(getFlag('rate')) : undefined,
    graduatedRate: getFlag('graduated-rate') ? Number(getFlag('graduated-rate')) : undefined,
    graduationThreshold: getFlag('graduation') ? Number(getFlag('graduation')) : undefined,
    mandatoryConfidenceBelow: getFlag('confidence-floor') ? Number(getFlag('confidence-floor')) : undefined,
    random: seed ? mulberry32(Number(seed)) : undefined
  });
  const policyLabel = `p=${policy.sampleRate}, graduated=${policy.graduatedRate}, threshold=${policy.graduationThreshold}, floor=${policy.mandatoryConfidenceBelow}`;

  const selection = await selectVerificationCandidates(neo4jDriver, policy);
  console.log(`Verification sweep [${policyLabel}]`);
  console.log(`  belief pool: ${selection.poolSize} (mandatory=${selection.poolByTier.mandatory}, sampled=${selection.poolByTier.sampled}, graduated=${selection.poolByTier.graduated})`);
  console.log(`  selected:    ${selection.candidates.length}`);

  if (hasFlag('dry-run')) {
    for (const c of selection.candidates) {
      console.log(`    [${c.tier}] ${c.subject} -> ${c.label} (confidence=${c.confidence ?? 'none'}, rubricVersion=${c.rubricVersion ?? 'none'}, verified_count=${c.verifiedCount})`);
    }
    return;
  }

  const oraclePath = getFlag('oracle');
  const oracle = oraclePath ? loadOracle(oraclePath) : undefined;

  if (hasFlag('sync')) {
    const classifier: Classifier = oracle ? makeOracleClassifier(oracle) : makeOpenAIClassifier();
    const report = await verifyBeliefs(neo4jDriver, pgPool, selection.candidates, classifier);
    console.log(`  classified ${report.classified}: ${report.agreed} agreed, ${report.disputed} disputed, ${report.skippedNoText} skipped (no live text), ${report.usage.subcalls} sub-call(s)`);
    for (const d of report.disputes) {
      console.log(`    DISPUTED ${d.subject}: cached '${d.label}' vs fresh '${d.disputedLabel}' — quarantined.`);
    }
    return;
  }

  const job = await verificationQueue.add('verification_sweep', {
    candidates: selection.candidates,
    oracle,
    policyLabel
  });
  console.log(`  enqueued job ${job.id} on verification_queue (${selection.candidates.length} candidate(s)) — start the verification worker to process it.`);
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
