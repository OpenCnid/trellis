import { spawn } from 'child_process';
import * as crypto from 'crypto';
import path from 'path';
import { pgPool, neo4jDriver } from '../src/config/db';
import { flattenAST } from '../src/core/ast/traverse';
import { buildCorpus } from '../src/benchmarks/oolong/corpus';
import { loadDataset, HARD_DATASET_PATH } from '../src/benchmarks/oolong/dataset_cli';
import { seedVerifiedCache, poisonCache } from '../src/benchmarks/oolong/poison';
import { auditFlywheelCache } from '../src/benchmarks/oolong/cache_audit';
import { selectResolutionCandidates } from '../src/core/graph/alias_resolution';
import { TREC_LABELS } from '../src/core/graph/entity_kinds';

// Session 6 benchmark hardening, live and zero-LLM (requires the
// docker-compose stack; no OpenAI key, no extraction jobs, no RLM):
//
//   1. Ingest the v2 anti-shortcut corpus through the REAL
//      verify-as-you-go loop via the new --dataset flag (hash round
//      trip, semantic constraints, passage constraints all enforced by
//      the loop itself — a nonzero exit fails this test).
//   2. The deterministic id-scoped REFERENCES traversal reproduces the
//      v2 ground-truth pair set exactly.
//   3. :Passage distractors carry resolvable provenance and can never
//      pair: no category, no REFERENCES, no :Question collision.
//   4. seedVerifiedCache + the shared cache-audit module report
//      accuracy 1.0 on a clean oracle seed; poisonCache + the same
//      module reflect exactly the flipped labels.
//   5. v2 question/label entities land in the question/category_label
//      kinds, and Session 5's alias-candidate selection proposes zero
//      pairs among them — the harder corpus stays structurally
//      invisible to entity resolution.
//   6. All seeded state is cleaned up; pre-existing rows (e.g. a
//      coexisting v1 ingest sharing city Concept nodes) are preserved.

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

const conceptGlobalId = (name: string) =>
  crypto.createHash('sha256').update(name.toLowerCase()).digest('hex');

const pairKey = (a: string, b: string) => `${a}|${b}`;

function runIngest(datasetPath: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs'),
        path.resolve('scripts', 'ingest_oolong_dataset.ts'),
        '--dataset', datasetPath
      ],
      { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function existingPgIds(ids: string[]): Promise<Set<string>> {
  const res = await pgPool.query(`SELECT id FROM ast_nodes WHERE id = ANY($1)`, [ids]);
  return new Set(res.rows.map(r => r.id));
}

async function existingNeo4jValues(cypher: string, params: Record<string, unknown>): Promise<Set<string>> {
  const session = neo4jDriver.session();
  try {
    const res = await session.run(cypher, params);
    return new Set(res.records.map(r => String(r.get(0))));
  } finally {
    await session.close();
  }
}

async function main(): Promise<void> {
  console.log('Session 6: benchmark hardening — v2 ingestion, deterministic pairs, cache audit, kind isolation');

  const dataset = loadDataset(HARD_DATASET_PATH);
  const passages = dataset.distractor_passages ?? [];
  const corpus = buildCorpus(dataset.records, passages);
  const questionIds = dataset.records.map(r => r.id);
  const passageIds = passages.map(p => p.id);
  const conceptNames = [...new Set(dataset.records.flatMap(r => r.concepts))];
  const conceptIds = conceptNames.map(conceptGlobalId);
  const allNodeIds = flattenAST(corpus.root).map(n => n.id);

  // Pre-snapshot so cleanup removes ONLY state this test created —
  // shared rows (a coexisting v1 ingest, shared city concepts, shared
  // TREC label entities) must survive.
  const preExistingPg = await existingPgIds(allNodeIds);
  const preExistingConcepts = await existingNeo4jValues(
    `MATCH (c:Concept) WHERE c.id IN $ids RETURN c.id`, { ids: conceptIds }
  );
  const preExistingLabelEntities = await existingNeo4jValues(
    `MATCH (e:Entity) WHERE e.name IN $labels RETURN e.name`, { labels: TREC_LABELS }
  );

  try {
    // 1. Real ingestion through the --dataset flag.
    console.log('\n[1] verify-as-you-go ingestion of the v2 corpus');
    const ingest = await runIngest(HARD_DATASET_PATH);
    if (ingest.code !== 0) {
      console.error(ingest.stdout.split('\n').slice(-20).join('\n'));
      console.error(ingest.stderr.split('\n').slice(-20).join('\n'));
    }
    check('ingestion loop exits 0 (all batches verified)', ingest.code, 0);
    check('ingestion output confirms completion', ingest.stdout.includes('Ingestion complete — all batches verified.'), true);
    check('ingestion reports the v2 dataset name', ingest.stdout.includes(dataset.name), true);

    const pgAfter = await existingPgIds(allNodeIds);
    check('every corpus AST node (root, blocks, leaves) has a Postgres row', pgAfter.size, allNodeIds.length);

    // 2. Deterministic pairs from REFERENCES edges, id-scoped.
    console.log('\n[2] deterministic pairs query vs v2 ground truth');
    const truth = new Set(dataset.ground_truth.loc_hum_shared_concept_pairs.map(([l, h]) => pairKey(l, h)));
    const session = neo4jDriver.session();
    let predicted: Set<string>;
    try {
      const res = await session.run(
        `MATCH (a:Question {category: 'LOC'})-[:REFERENCES]->(c:Concept)<-[:REFERENCES]-(b:Question {category: 'HUM'})
         WHERE a.id IN $questionIds AND b.id IN $questionIds
         RETURN DISTINCT a.id AS locId, b.id AS humId`,
        { questionIds }
      );
      predicted = new Set(res.records.map(r => pairKey(r.get('locId'), r.get('humId'))));
    } finally {
      await session.close();
    }
    check('traversal pair count matches ground truth', predicted.size, truth.size);
    check('traversal reproduces ground truth exactly (F1 = 1)',
      [...predicted].every(k => truth.has(k)) && [...truth].every(k => predicted.has(k)), true);
    check('ground truth is non-trivial (paraphrased cities still pair)', truth.size > 100, true);

    // 3. Passage distractor constraints.
    console.log('\n[3] :Passage distractors');
    const pSession = neo4jDriver.session();
    let passageRows: Array<{ id: string; sources: string[]; category: unknown; refs: number; questions: number }>;
    try {
      const res = await pSession.run(
        `MATCH (p:Passage) WHERE p.id IN $ids
         RETURN p.id AS id, p.sourceNodeIds AS sources, p.category AS category,
                size([(p)-[:REFERENCES]->() | 1]) AS refs,
                COUNT { MATCH (q:Question) WHERE q.id = p.id } AS questions`,
        { ids: passageIds }
      );
      passageRows = res.records.map(r => ({
        id: r.get('id'),
        sources: r.get('sources'),
        category: r.get('category'),
        refs: r.get('refs').toNumber(),
        questions: r.get('questions').toNumber()
      }));
    } finally {
      await pSession.close();
    }
    check('all 20 passages landed as :Passage nodes', passageRows.length, passageIds.length);
    check('no passage carries a category', passageRows.every(p => p.category == null), true);
    check('no passage carries REFERENCES edges', passageRows.every(p => p.refs === 0), true);
    check('no passage id collides with a :Question', passageRows.every(p => p.questions === 0), true);
    const passageSourceIds = [...new Set(passageRows.flatMap(p => p.sources))];
    const resolvedPassageSources = await existingPgIds(passageSourceIds);
    check('every passage sourceNodeId resolves to a physical AST row',
      resolvedPassageSources.size, passageSourceIds.length);

    // 4. Cache seed + shared audit module; then poison + audit.
    console.log('\n[4] oracle cache seed, audit, poison, audit');
    const seeded = await seedVerifiedCache(neo4jDriver, dataset);
    check('oracle seed covers every v2 question', seeded.seeded, dataset.records.length);

    const cleanAudit = await auditFlywheelCache(neo4jDriver, dataset);
    check('clean seed audits at accuracy 1.0', cleanAudit.accuracy, 1);
    check('clean seed grades every question', cleanAudit.cached, dataset.records.length);
    check('clean seed has zero wrong/unknown', [cleanAudit.wrong, cleanAudit.unknown], [0, 0]);

    const manifest = await poisonCache(neo4jDriver, dataset, { count: 11, seed: 4242 });
    check('poison flipped 11 labels', manifest.poisoned.length, 11);

    const poisonedAudit = await auditFlywheelCache(neo4jDriver, dataset);
    check('audit counts exactly the flipped labels as wrong', poisonedAudit.wrong, 11);
    check('audit accuracy reflects the poison rate',
      poisonedAudit.accuracy, (dataset.records.length - 11) / dataset.records.length);
    const poisonedIds = new Set(manifest.poisoned.map(p => p.id));
    check('every audited mistake is a poisoned edge',
      poisonedAudit.mistakes.every(m => poisonedIds.has(m.qid)), true);
    check('audited mistakes carry the poisoned labels',
      poisonedAudit.mistakes.every(m =>
        manifest.poisoned.find(p => p.id === m.qid)?.poisonedLabel === m.cached.toLowerCase()), true);

    // 5. Entity kinds + alias-resolution isolation (Session 5 contract).
    console.log('\n[5] entity kinds and alias-resolution isolation');
    const kindSession = neo4jDriver.session();
    let questionKinds: string[];
    let labelKinds: string[];
    try {
      const qk = await kindSession.run(
        `MATCH (e:Entity) WHERE e.name IN $ids RETURN DISTINCT coalesce(e.kind, '__missing__') AS kind`,
        { ids: questionIds }
      );
      questionKinds = qk.records.map(r => r.get('kind'));
      const lk = await kindSession.run(
        `MATCH (e:Entity) WHERE e.name IN $labels RETURN DISTINCT coalesce(e.kind, '__missing__') AS kind`,
        { labels: TREC_LABELS }
      );
      labelKinds = lk.records.map(r => r.get('kind'));
    } finally {
      await kindSession.close();
    }
    check("v2 question entities all carry kind 'question'", questionKinds, ['question']);
    check("TREC label entities all carry kind 'category_label'", labelKinds, ['category_label']);

    const selection = await selectResolutionCandidates(neo4jDriver, { maxPairs: 5000 });
    const benchmarkNames = new Set([...questionIds, ...TREC_LABELS]);
    const touching = selection.pairs.filter(
      p => benchmarkNames.has(p.a.name) || benchmarkNames.has(p.b.name)
    );
    check('alias resolution proposes zero pairs touching v2 question/label entities', touching.length, 0);
  } finally {
    // 6. Cleanup: only what this test created.
    console.log('\n[6] cleanup');
    const cSession = neo4jDriver.session();
    try {
      await cSession.run(
        `MATCH (e:Entity) WHERE e.name IN $ids DETACH DELETE e`, { ids: questionIds }
      );
      const newLabels = TREC_LABELS.filter(l => !preExistingLabelEntities.has(l));
      if (newLabels.length > 0) {
        await cSession.run(
          `MATCH (e:Entity) WHERE e.name IN $labels DETACH DELETE e`, { labels: newLabels }
        );
      }
      await cSession.run(`MATCH (q:Question) WHERE q.id IN $ids DETACH DELETE q`, { ids: questionIds });
      await cSession.run(`MATCH (p:Passage) WHERE p.id IN $ids DETACH DELETE p`, { ids: passageIds });
      const newConcepts = conceptIds.filter(id => !preExistingConcepts.has(id));
      if (newConcepts.length > 0) {
        await cSession.run(`MATCH (c:Concept) WHERE c.id IN $ids DETACH DELETE c`, { ids: newConcepts });
      }
    } finally {
      await cSession.close();
    }
    const newPgIds = allNodeIds.filter(id => !preExistingPg.has(id));
    if (newPgIds.length > 0) {
      await pgPool.query(`DELETE FROM ast_nodes WHERE id = ANY($1)`, [newPgIds]);
    }
    console.log(`  Removed ${questionIds.length} question entities/nodes, ${passageIds.length} passages, ${newPgIds.length} AST rows (pre-existing shared rows preserved).`);
  }
}

main()
  .then(async () => {
    await pgPool.end();
    await neo4jDriver.close();
    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async err => {
    console.error(`\nTest run error: ${err.stack ?? err.message}`);
    try { await pgPool.end(); await neo4jDriver.close(); } catch {}
    process.exit(1);
  });
