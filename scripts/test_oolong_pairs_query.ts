import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { neo4jDriver } from '../src/config/db';
import { OolongDatasetSchema } from '../src/benchmarks/oolong/schema';

// Task 2a: Topological Traversal Query Test.
//
// Retrieves every pair of (LOC, HUM) questions that REFERENCES the same
// :Concept node — the quadratic OOLONG-Pairs task collapsed into a
// single graph traversal — and cross-checks the result against the
// dataset's ground-truth answer key.

const DATASET_PATH = path.join(__dirname, '..', 'data', 'oolong_pairs_dataset.json');

// Boundary validation for what comes back from the database
const PairRowSchema = z.object({
  locId: z.string().min(1),
  humId: z.string().min(1),
  sharedConcepts: z.array(z.string().min(1)).min(1)
});

const pairKey = (locId: string, humId: string) => `${locId}|${humId}`;

async function main(): Promise<void> {
  console.log('======================================================');
  console.log('Task 2a: Topological Traversal Query Test (LOC-HUM pairs)');
  console.log('======================================================');

  const dataset = OolongDatasetSchema.parse(JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8')));
  const truth = new Set(
    dataset.ground_truth.loc_hum_shared_concept_pairs.map(([loc, hum]) => pairKey(loc, hum))
  );
  console.log(`Ground truth loaded: ${truth.size} expected LOC-HUM pairs.`);

  const session = neo4jDriver.session();
  let rows: z.infer<typeof PairRowSchema>[];
  try {
    const result = await session.run(`
      MATCH (a:Question {category: 'LOC'})-[:REFERENCES]->(c:Concept)<-[:REFERENCES]-(b:Question {category: 'HUM'})
      RETURN a.id AS locId, b.id AS humId, collect(DISTINCT c.name) AS sharedConcepts
      ORDER BY locId, humId
    `);
    rows = result.records.map(r =>
      PairRowSchema.parse({
        locId: r.get('locId'),
        humId: r.get('humId'),
        sharedConcepts: r.get('sharedConcepts')
      })
    );
  } finally {
    await session.close();
  }

  console.log(`Query returned ${rows.length} pairs. Structure Zod-validated (locId, humId, sharedConcepts[]).`);
  console.log('Sample rows:');
  for (const row of rows.slice(0, 5)) {
    console.log(`  (${row.locId})-[:REFERENCES]->(${row.sharedConcepts.join(', ')})<-[:REFERENCES]-(${row.humId})`);
  }

  const predicted = new Set(rows.map(r => pairKey(r.locId, r.humId)));
  if (predicted.size !== rows.length) {
    throw new Error(`Duplicate pairs returned by traversal: ${rows.length} rows vs ${predicted.size} unique keys.`);
  }

  const truePositives = [...predicted].filter(k => truth.has(k)).length;
  const precision = predicted.size === 0 ? 0 : truePositives / predicted.size;
  const recall = truth.size === 0 ? 0 : truePositives / truth.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  console.log('\nSet-based scoring vs ground truth:');
  console.log(`  True positives: ${truePositives}`);
  console.log(`  Precision:      ${precision.toFixed(4)}`);
  console.log(`  Recall:         ${recall.toFixed(4)}`);
  console.log(`  F1-score:       ${f1.toFixed(4)}`);

  if (f1 !== 1) {
    const missing = [...truth].filter(k => !predicted.has(k)).slice(0, 5);
    const spurious = [...predicted].filter(k => !truth.has(k)).slice(0, 5);
    throw new Error(
      `Traversal does not reproduce ground truth exactly. ` +
      `Missing: [${missing.join('; ')}] Spurious: [${spurious.join('; ')}]`
    );
  }

  console.log('\n✅ VERIFIED: graph traversal reproduces the ground-truth pair set exactly (F1 = 1.0).');
}

main()
  .then(async () => {
    await neo4jDriver.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\nTASK 2a FAILED: ${err.message}`);
    await neo4jDriver.close().catch(() => {});
    process.exit(1);
  });
