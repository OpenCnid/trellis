import * as fs from 'fs';
import * as path from 'path';
import { neo4jDriver } from '../src/config/db';
import { OolongDatasetSchema } from '../src/benchmarks/oolong/schema';

// Audits the RLM's cached HAS_CATEGORY insights against the dataset's
// ground-truth labels — measures how trustworthy the flywheel cache is.

const DATASET_PATH = path.join(__dirname, '..', 'data', 'oolong_pairs_dataset.json');

async function main(): Promise<void> {
  const dataset = OolongDatasetSchema.parse(JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8')));
  const truth = new Map(dataset.records.map(r => [r.id, r.category]));

  const session = neo4jDriver.session();
  let rows: Array<{ qid: string; label: string }>;
  try {
    const res = await session.run(
      `MATCH (s:Entity)-[r:DERIVED_INSIGHT]->(o:Entity)
       WHERE r.verb = 'has_category'
       RETURN s.name AS qid, o.name AS label`
    );
    rows = res.records.map(r => ({ qid: r.get('qid'), label: r.get('label') }));
  } finally {
    await session.close();
    await neo4jDriver.close();
  }

  let correct = 0, wrong = 0, unknown = 0;
  const mistakes: string[] = [];
  for (const { qid, label } of rows) {
    const expected = truth.get(qid);
    if (!expected) { unknown++; continue; }
    if (expected.toLowerCase() === label.toLowerCase()) correct++;
    else {
      wrong++;
      if (mistakes.length < 15) mistakes.push(`${qid}: cached=${label} truth=${expected}`);
    }
  }

  console.log(`Cached has_category insights: ${rows.length}`);
  console.log(`  Correct: ${correct}  Wrong: ${wrong}  Unknown qid: ${unknown}`);
  console.log(`  Accuracy: ${(correct / Math.max(1, correct + wrong) * 100).toFixed(1)}%`);
  if (mistakes.length) {
    console.log('  Sample mistakes:');
    for (const m of mistakes) console.log(`    ${m}`);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
