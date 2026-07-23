import * as fs from 'fs';
import * as path from 'path';
import { OolongDatasetSchema } from '../src/benchmarks/oolong/schema';
import { reingestDataset, auditInvalidation, DRILL_DOC_KEY } from '../src/benchmarks/oolong/reingest';
import { pgPool, neo4jDriver } from '../src/config/db';
import {
  assertConfirmed,
  assertDrillTarget,
  liveMarkerReaders,
  printTargetBanner,
  reportRefusal,
} from '../src/core/runtime/drill_target';

// Update Drill Act 3 (CLI): versioned re-ingest of an OOLONG dataset
// under the drill doc_key, with Merkle diff + quarantine sweep, followed
// by the invalidation audit against the mutation manifest (if present).
//
//   npx tsx scripts/reingest_oolong_dataset.ts [datasetPath] [--doc-key k] \
//     [--keep-category] [--no-audit] --confirm-reingest
//
// First run (empty registry) is the "adopt" path: it registers the
// dataset as v1 and records membership; the semantic layer must already
// have been ingested via `npm run oolong:ingest`.
//
// Re-ingest publishes a new document version and runs a quarantine sweep
// that contests beliefs whose provenance died — real, effective writes to
// both stores under an operator-supplied doc_key. It refuses unless both
// databases carry a drill-target marker AND the echoed plan was confirmed.

const DEFAULT_DATASET = path.join(__dirname, '..', 'data', 'oolong_pairs_dataset_v2.json');
const MANIFEST_PATH = path.join(__dirname, '..', 'data', 'update_drill_manifest.json');
const TELEMETRY_PATH = path.join(__dirname, '..', 'data', 'update_drill_reingest.json');

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  const datasetPath = positional[0] ?? DEFAULT_DATASET;
  const docKeyArg = args.indexOf('--doc-key');
  const docKey = docKeyArg !== -1 ? args[docKeyArg + 1] : DRILL_DOC_KEY;
  const stripCategory = !args.includes('--keep-category');
  const runAudit = !args.includes('--no-audit');
  const confirmed = args.includes('--confirm-reingest');

  const dataset = OolongDatasetSchema.parse(JSON.parse(fs.readFileSync(datasetPath, 'utf8')));
  console.log('======================================================');
  console.log(`Update Drill re-ingest: "${dataset.name}" under doc_key "${docKey}"`);
  console.log('======================================================');

  const markers = await assertDrillTarget(['neo4j', 'postgres'], liveMarkerReaders(neo4jDriver, pgPool));
  printTargetBanner(['neo4j', 'postgres'], markers);

  const existing = await pgPool.query(
    'SELECT count(DISTINCT root_hash)::int AS n FROM documents WHERE doc_key = $1',
    [docKey]
  );
  console.log('\nThis will re-ingest:');
  console.log(`  dataset:   ${dataset.name} (${dataset.records.length} records, ${datasetPath})`);
  console.log(`  doc_key:   "${docKey}"`
    + `${docKey === DRILL_DOC_KEY ? ' (the drill default)' : ' — NOT the drill default'}`);
  console.log(`  registry:  ${existing.rows[0].n} existing version(s)`
    + `${existing.rows[0].n === 0 ? ' — this is the adopt path (no diff, no sweep)' : ' — publishes a new version and sweeps'}`);
  console.log(`  category:  ${stripCategory ? 'stripped' : 'kept'}`);
  console.log('  The sweep contests beliefs whose provenance the new version orphans.');

  assertConfirmed({
    confirmed,
    flag: '--confirm-reingest',
    act: `re-ingest publishes a new version of doc_key "${docKey}" and quarantines `
      + 'beliefs whose cited bytes no longer exist.',
  });

  const telemetry = await reingestDataset(dataset, { docKey, stripCategory });

  console.log(`  Version:   ${telemetry.fromVersion === null ? '(adopted as)' : `v${telemetry.fromVersion} ->`} v${telemetry.toVersion}`);
  console.log(`  Merkle root: ${telemetry.rootHash}`);
  if (telemetry.diff) {
    console.log(`  Diff:      added ${telemetry.diff.added} | orphaned ${telemetry.diff.orphaned} | retained ${telemetry.diff.retained} (of ${telemetry.totalNodes} nodes)`);
    console.log(`  Changed records: ${telemetry.changedRecords.length}/${telemetry.totalRecords} -> ${telemetry.changedRecords.join(', ') || '(none)'}`);
    console.log(`  Reprocessing ratio: ${(telemetry.reprocessing_ratio_records * 100).toFixed(1)}% of records, ${(telemetry.reprocessing_ratio_leaves * 100).toFixed(1)}% of leaf nodes`);
    console.log(`  Sweep:     contested ${telemetry.sweep.contestedNodes} node(s), ${telemetry.sweep.contestedRelationships} relationship(s)`);
  } else {
    console.log(`  Adopt path: registered v1 (${telemetry.totalNodes} nodes, membership recorded). No diff, no sweep.`);
  }

  let audit = null;
  if (runAudit && telemetry.diff && fs.existsSync(MANIFEST_PATH)) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    audit = await auditInvalidation(manifest);
    console.log(`  Invalidation audit (vs manifest):`);
    console.log(`    recall    ${audit.recall.toFixed(3)} (${audit.affected_contested}/${audit.affected} affected cached facts contested; target 1.000)`);
    console.log(`    precision ${audit.precision.toFixed(3)} (${audit.affected_contested}/${audit.total_contested} contested were affected; target >= 0.950)`);
    if (audit.missed_ids.length) console.log(`    MISSED: ${audit.missed_ids.join(', ')}`);
    if (audit.false_positive_ids.length) console.log(`    extra contested: ${audit.false_positive_ids.join(', ')}`);
  }

  fs.writeFileSync(TELEMETRY_PATH, JSON.stringify({ ...telemetry, invalidation_audit: audit }, null, 2) + '\n');
  console.log(`\n  Telemetry written to ${TELEMETRY_PATH}`);
  return 0;
}

main()
  .then(async code => {
    await Promise.allSettled([pgPool.end(), neo4jDriver.close()]);
    process.exit(code);
  })
  .catch(async err => {
    const refusalCode = reportRefusal(err);
    if (refusalCode === null) {
      console.error(`RE-INGEST FAILED: ${err instanceof Error ? err.message : err}`);
    }
    await Promise.allSettled([pgPool.end(), neo4jDriver.close()]);
    process.exit(refusalCode ?? 1);
  });
