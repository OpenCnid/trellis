import { neo4jDriver } from '../src/config/db';

// Flywheel benchmark preparation.
//
// Task 1c ingested the dataset FULLY annotated (category + REFERENCES),
// which would leave the RLM nothing to classify — every query would be a
// pure graph lookup and the Flywheel Hypothesis would be untestable.
//
// This script simulates the real OOLONG starting state: the physical AST
// layer (Postgres) is untouched, :Question nodes keep id/text/sourceNodeIds,
// but the semantic classifications are stripped:
//   - REMOVE q.category
//   - DELETE (:Question)-[:REFERENCES]->(:Concept) edges + orphaned Concepts
//   - DELETE all cached [DERIVED_INSIGHT] edges + orphaned flywheel Entities
//
// Re-running `npm run oolong:ingest` fully restores the annotated graph.

async function main(): Promise<void> {
  console.log('======================================================');
  console.log('Flywheel prep: stripping semantic annotations');
  console.log('======================================================');

  const session = neo4jDriver.session();
  try {
    const cat = await session.run(`MATCH (q:Question) WHERE q.category IS NOT NULL REMOVE q.category RETURN count(q) AS n`);
    console.log(`  Removed category from ${cat.records[0].get('n').toNumber()} :Question nodes.`);

    const refs = await session.run(`MATCH (:Question)-[r:REFERENCES]->(:Concept) DELETE r RETURN count(r) AS n`);
    console.log(`  Deleted ${refs.records[0].get('n').toNumber()} [:REFERENCES] edges.`);

    const concepts = await session.run(`MATCH (c:Concept) WHERE NOT (c)--() DELETE c RETURN count(c) AS n`);
    console.log(`  Deleted ${concepts.records[0].get('n').toNumber()} orphaned :Concept nodes.`);

    const insights = await session.run(`MATCH ()-[r:DERIVED_INSIGHT]->() DELETE r RETURN count(r) AS n`);
    console.log(`  Reset flywheel cache: deleted ${insights.records[0].get('n').toNumber()} [:DERIVED_INSIGHT] edges.`);

    const orphans = await session.run(`MATCH (e:Entity) WHERE NOT (e)--() AND (e.name =~ 'q_[0-9]+' OR e.sourceNodeIds IS NOT NULL) DELETE e RETURN count(e) AS n`);
    console.log(`  Deleted ${orphans.records[0].get('n').toNumber()} orphaned flywheel :Entity nodes.`);

    const check = await session.run(`MATCH (q:Question) RETURN count(q) AS n, count(q.text) AS texts`);
    const n = check.records[0].get('n').toNumber();
    const texts = check.records[0].get('texts').toNumber();
    console.log(`\n  Remaining: ${n} :Question nodes (${texts} with text + sourceNodeIds intact).`);
    console.log('  Physical AST layer (Postgres) untouched.');
    console.log('\n✅ Graph is now unannotated — the RLM must classify and cache via write_derived_insight.');
    console.log('   (Restore full annotations any time with: npm run oolong:ingest)');
  } finally {
    await session.close();
    await neo4jDriver.close();
  }
}

main().catch(err => {
  console.error(`FLYWHEEL PREP FAILED: ${err.message}`);
  process.exit(1);
});
