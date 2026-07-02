import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { pgPool, neo4jDriver } from '../src/config/db';
import { parseMarkdownToAST, ASTNode } from '../src/core/ast/parser';
import { OolongDatasetSchema } from '../src/benchmarks/oolong/schema';
import { buildCorpus, BoundRecord, flattenAST } from '../src/benchmarks/oolong/corpus';
import { withRetry } from '../src/benchmarks/oolong/retry';

// Task 1c: Ingestion-as-a-Loop.
//
//   Fetch micro-batch -> write AST nodes (Postgres, transactional)
//     -> verify hash integrity (read back, re-derive via parser, match)
//     -> write Question/Concept nodes + REFERENCES edges (Neo4j)
//     -> verify mapped constraints (sourceNodeIds resolve to real AST rows)
//     -> advance only on PASS; log & retry the batch on FAIL.

const DATASET_PATH = path.join(__dirname, '..', 'data', 'oolong_pairs_dataset.json');
const BATCH_SIZE = 40;
const MAX_BATCH_ATTEMPTS = 3;

// UUID Collision Invariant: concept identity is the SHA-256 of the
// normalized lowercase name, so distributed MERGEs can never collide.
function conceptGlobalId(name: string): string {
  return crypto.createHash('sha256').update(name.toLowerCase()).digest('hex');
}

// ---------------------------------------------------------------
// Phase A: write all AST nodes of the batch inside one transaction
// ---------------------------------------------------------------
async function writeAstNodes(documentId: string, nodes: ASTNode[]): Promise<void> {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    for (const node of nodes) {
      await client.query(
        `INSERT INTO ast_nodes (id, document_id, data)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [node.id, documentId, JSON.stringify(node)]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------
// Phase B: hash-integrity verification. Read the rows back, then
// re-derive every hash from the record's markdown through the parser
// (the only hash authority — Golden Rule of the AST) and match.
// -----------------------------------------------------------------
async function verifyPostgresHashIntegrity(batch: BoundRecord[]): Promise<void> {
  const expectedIds = new Set<string>();
  for (const b of batch) {
    for (const node of [...flattenAST(b.heading), ...flattenAST(b.paragraph)]) {
      expectedIds.add(node.id);
    }
  }

  const res = await pgPool.query(
    `SELECT id, data FROM ast_nodes WHERE id = ANY($1)`,
    [[...expectedIds]]
  );
  const storedById = new Map<string, any>(res.rows.map(r => [r.id, r.data]));

  for (const id of expectedIds) {
    if (!storedById.has(id)) {
      throw new Error(`Hash integrity FAIL: node ${id} missing after write-back read.`);
    }
  }

  // Independent re-derivation: parse each record's standalone markdown
  // snippet from scratch. Content addressing makes block hashes
  // context-free, so they must equal the stored corpus hashes exactly.
  for (const b of batch) {
    const reparsedRoot = parseMarkdownToAST(b.markdown);
    const reparsedBlocks = (reparsedRoot.children ?? []).flatMap(block => flattenAST(block));
    for (const derived of reparsedBlocks) {
      const stored = storedById.get(derived.id);
      if (!stored) {
        throw new Error(
          `Hash integrity FAIL for ${b.record.id}: parser re-derived node ${derived.id} ` +
          `(${derived.type}) which is not present in Postgres.`
        );
      }
      if (stored.type !== derived.type || (stored.content ?? null) !== (derived.content ?? null)) {
        throw new Error(
          `Hash integrity FAIL for ${b.record.id}: stored payload for ${derived.id} ` +
          `does not match parser derivation.`
        );
      }
    }
  }
}

// ------------------------------------------------------------------
// Phase C: write the semantic layer for the batch in one transaction
// ------------------------------------------------------------------
async function writeSemanticLayer(batch: BoundRecord[]): Promise<void> {
  const questions = batch.map(b => ({
    id: b.record.id,
    text: b.record.text,
    category: b.record.category,
    sourceNodeIds: [b.paragraph.id, b.heading.id]
  }));

  const concepts = batch.flatMap(b =>
    b.record.concepts.map(name => ({
      id: conceptGlobalId(name),
      name: name.toLowerCase(),
      sourceNodeIds: [b.paragraph.id]
    }))
  );

  const references = batch.flatMap(b =>
    b.record.concepts.map(name => ({
      questionId: b.record.id,
      conceptId: conceptGlobalId(name),
      sourceNodeIds: [b.paragraph.id]
    }))
  );

  const session = neo4jDriver.session();
  try {
    const tx = session.beginTransaction();

    await tx.run(
      `UNWIND $questions AS q
       MERGE (n:Question {id: q.id})
       SET n.text = q.text, n.category = q.category, n.sourceNodeIds = q.sourceNodeIds`,
      { questions }
    );

    await tx.run(
      `UNWIND $concepts AS c
       MERGE (n:Concept {id: c.id})
       ON CREATE SET n.name = c.name, n.sourceNodeIds = c.sourceNodeIds
       ON MATCH SET n.sourceNodeIds = n.sourceNodeIds + [id IN c.sourceNodeIds WHERE NOT id IN n.sourceNodeIds]`,
      { concepts }
    );

    await tx.run(
      `UNWIND $references AS r
       MATCH (q:Question {id: r.questionId})
       MATCH (c:Concept {id: r.conceptId})
       MERGE (q)-[e:REFERENCES]->(c)
       ON CREATE SET e.sourceNodeIds = r.sourceNodeIds
       ON MATCH SET e.sourceNodeIds = e.sourceNodeIds + [id IN r.sourceNodeIds WHERE NOT id IN e.sourceNodeIds]`,
      { references }
    );

    await tx.commit();
  } finally {
    await session.close();
  }
}

// -------------------------------------------------------------------
// Phase D: mapped-constraint verification. Every :Question in the
// batch must carry the exact sourceNodeIds the parser derived, every
// one of those hashes must exist as a Postgres ast_nodes row, and the
// REFERENCES fan-out must match the record's concept annotations.
// -------------------------------------------------------------------
async function verifyNeo4jMappedConstraints(batch: BoundRecord[]): Promise<void> {
  const session = neo4jDriver.session();
  let rows: Array<{ id: string; sourceNodeIds: string[]; refConceptIds: string[] }>;
  try {
    const result = await session.run(
      `MATCH (q:Question) WHERE q.id IN $ids
       RETURN q.id AS id, q.sourceNodeIds AS sourceNodeIds,
              [(q)-[:REFERENCES]->(c) | c.id] AS refConceptIds`,
      { ids: batch.map(b => b.record.id) }
    );
    rows = result.records.map(r => ({
      id: r.get('id'),
      sourceNodeIds: r.get('sourceNodeIds'),
      refConceptIds: r.get('refConceptIds')
    }));
  } finally {
    await session.close();
  }

  const rowById = new Map(rows.map(r => [r.id, r]));
  const allSourceIds = new Set<string>();

  for (const b of batch) {
    const row = rowById.get(b.record.id);
    if (!row) {
      throw new Error(`Constraint FAIL: :Question {id: "${b.record.id}"} missing from Neo4j.`);
    }

    const expectedSources = [b.paragraph.id, b.heading.id];
    if (
      row.sourceNodeIds.length !== expectedSources.length ||
      expectedSources.some(id => !row.sourceNodeIds.includes(id))
    ) {
      throw new Error(`Constraint FAIL: ${b.record.id} sourceNodeIds do not match parser-derived hashes.`);
    }
    row.sourceNodeIds.forEach(id => allSourceIds.add(id));

    const expectedConceptIds = new Set(b.record.concepts.map(conceptGlobalId));
    const actualConceptIds = new Set(row.refConceptIds);
    if (
      expectedConceptIds.size !== actualConceptIds.size ||
      [...expectedConceptIds].some(id => !actualConceptIds.has(id))
    ) {
      throw new Error(`Constraint FAIL: ${b.record.id} REFERENCES edges do not match its concept annotations.`);
    }
  }

  // The provenance bridge: every sourceNodeId in the semantic layer
  // must resolve to a physical AST row.
  const idsArray = [...allSourceIds];
  const res = await pgPool.query(`SELECT id FROM ast_nodes WHERE id = ANY($1)`, [idsArray]);
  if (res.rows.length !== idsArray.length) {
    const found = new Set(res.rows.map(r => r.id));
    const missing = idsArray.filter(id => !found.has(id));
    throw new Error(`Constraint FAIL: ${missing.length} sourceNodeIds dangle (no Postgres row): ${missing.slice(0, 3).join(', ')}...`);
  }
}

// ------------------------------------------------
// Idempotent prerequisites (table + graph indexes)
// ------------------------------------------------
async function ensurePrerequisites(): Promise<void> {
  await withRetry('Postgres schema check', async () => {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS ast_nodes (
        id VARCHAR PRIMARY KEY,
        document_id VARCHAR,
        data JSONB,
        embedding vector(1536)
      );
    `);
  });

  await withRetry('Neo4j constraint check', async () => {
    const session = neo4jDriver.session();
    try {
      await session.run(`CREATE CONSTRAINT oolong_question_id IF NOT EXISTS FOR (q:Question) REQUIRE q.id IS UNIQUE`);
      await session.run(`CREATE CONSTRAINT oolong_concept_id IF NOT EXISTS FOR (c:Concept) REQUIRE c.id IS UNIQUE`);
    } finally {
      await session.close();
    }
  });
}

async function main(): Promise<void> {
  console.log('======================================================');
  console.log('Task 1c: OOLONG-Pairs Full Ingestion Verification Loop');
  console.log('======================================================');

  // Boundary validation (Architecture Invariant 3)
  const raw = fs.readFileSync(DATASET_PATH, 'utf8');
  const dataset = OolongDatasetSchema.parse(JSON.parse(raw));
  console.log(`Dataset "${dataset.name}": ${dataset.records.length} records loaded and Zod-validated.`);

  // Single deterministic parse of the whole corpus; all hashes below
  // come from this parser output (Merkle Math Invariant).
  const corpus = buildCorpus(dataset.records);
  console.log(`Corpus parsed. Merkle root (document_id): ${corpus.documentId}`);

  await ensurePrerequisites();

  // The root document node is physical too — persist it up front.
  await withRetry('Root document node write', () =>
    writeAstNodes(corpus.documentId, [corpus.root])
  );

  const totalBatches = Math.ceil(corpus.bound.length / BATCH_SIZE);
  let ingestedRecords = 0;

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batch = corpus.bound.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);
    const label = `Batch ${batchIndex + 1}/${totalBatches} (${batch.length} records)`;

    let passed = false;
    for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS && !passed; attempt++) {
      try {
        const astNodes = batch.flatMap(b => [...flattenAST(b.heading), ...flattenAST(b.paragraph)]);

        await withRetry(`${label} / Postgres write`, () => writeAstNodes(corpus.documentId, astNodes));
        await withRetry(`${label} / Postgres read-back`, () => verifyPostgresHashIntegrity(batch));
        console.log(`  [PASS] ${label}: Postgres hash integrity (${astNodes.length} nodes re-derived & matched).`);

        await withRetry(`${label} / Neo4j write`, () => writeSemanticLayer(batch));
        await withRetry(`${label} / Neo4j read-back`, () => verifyNeo4jMappedConstraints(batch));
        console.log(`  [PASS] ${label}: Neo4j mapped constraints (sourceNodeIds resolve to physical rows).`);

        passed = true;
      } catch (err: any) {
        console.error(`  [FAIL] ${label} attempt ${attempt}/${MAX_BATCH_ATTEMPTS}: ${err.message}`);
        if (attempt === MAX_BATCH_ATTEMPTS) {
          throw new Error(`${label} exhausted all attempts. Aborting ingestion — loop will NOT advance past a failing batch.`);
        }
        console.log(`  [RETRY] Re-running ${label} from the top...`);
      }
    }

    ingestedRecords += batch.length;
    console.log(`  [ADVANCE] ${label} committed. Progress: ${ingestedRecords}/${corpus.bound.length} records.`);
  }

  // Final global tallies
  const pgCount = await pgPool.query(`SELECT COUNT(*)::int AS n FROM ast_nodes WHERE document_id = $1`, [corpus.documentId]);
  const session = neo4jDriver.session();
  let questionCount = 0, conceptCount = 0, refCount = 0;
  try {
    const qc = await session.run(`MATCH (q:Question) RETURN count(q) AS n`);
    const cc = await session.run(`MATCH (c:Concept) RETURN count(c) AS n`);
    const rc = await session.run(`MATCH (:Question)-[r:REFERENCES]->(:Concept) RETURN count(r) AS n`);
    questionCount = qc.records[0].get('n').toNumber();
    conceptCount = cc.records[0].get('n').toNumber();
    refCount = rc.records[0].get('n').toNumber();
  } finally {
    await session.close();
  }

  console.log('\n======================================================');
  console.log('Ingestion complete — all batches verified.');
  console.log('======================================================');
  console.log(`  Postgres ast_nodes rows (this document): ${pgCount.rows[0].n}`);
  console.log(`  Neo4j :Question nodes:                   ${questionCount}`);
  console.log(`  Neo4j :Concept nodes:                    ${conceptCount}`);
  console.log(`  Neo4j [:REFERENCES] edges:               ${refCount}`);
  console.log(`  Document Merkle root:                    ${corpus.documentId}`);
}

main()
  .then(async () => {
    await pgPool.end();
    await neo4jDriver.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\nINGESTION ABORTED: ${err.message}`);
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(1);
  });
