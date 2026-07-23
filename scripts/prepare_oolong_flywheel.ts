import { neo4jDriver } from '../src/config/db';
import {
  assertConfirmed,
  assertDrillTarget,
  printTargetBanner,
  readNeo4jMarker,
  reportRefusal,
} from '../src/core/runtime/drill_target';

// Flywheel benchmark preparation.
//
//   npm run oolong:flywheel-prep                     (plan only)
//   npm run oolong:flywheel-prep -- --confirm-strip  (strip)
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
// Two of those passes are UNSCOPED over the graph — every category on
// every :Question, every DERIVED_INSIGHT edge in the database, not only
// the ones this benchmark created. That is correct for a scratch
// benchmark graph and catastrophic anywhere else, so the run refuses
// twice: once unless the graph carries a drill-target marker, and once
// unless the counts below were reviewed and --confirm-strip supplied.
//
// Re-running `npm run oolong:ingest` fully restores the annotated graph.

async function countPlan(): Promise<Record<string, number>> {
  const session = neo4jDriver.session();
  try {
    // COUNT subqueries so an empty graph still returns exactly one row —
    // a chained MATCH would return none and hide the plan entirely.
    const result = await session.executeRead(tx =>
      tx.run(
        `RETURN COUNT { MATCH (q:Question) WHERE q.category IS NOT NULL } AS categories,
                COUNT { MATCH (:Question)-[r:REFERENCES]->(:Concept) } AS references,
                COUNT { MATCH ()-[d:DERIVED_INSIGHT]->() } AS insights`
      )
    );
    const record = result.records[0];
    return {
      categories: record.get('categories').toNumber(),
      references: record.get('references').toNumber(),
      insights: record.get('insights').toNumber(),
    };
  } finally {
    await session.close();
  }
}

async function main(): Promise<number> {
  const confirmed = process.argv.includes('--confirm-strip');

  console.log('======================================================');
  console.log('Flywheel prep: stripping semantic annotations');
  console.log('======================================================');

  const markers = await assertDrillTarget(['neo4j'], {
    neo4j: () => readNeo4jMarker(neo4jDriver),
    postgres: async () => null,
  });
  printTargetBanner(['neo4j'], markers);

  // Echo the exact scope before any delete (the promote_segment idiom).
  const plan = await countPlan();
  console.log('\nThis will strip, GRAPH-WIDE:');
  console.log(`  ${plan.categories} :Question node(s) lose their category`);
  console.log(`  ${plan.references} [:REFERENCES] edge(s) deleted, plus every :Concept left orphaned`);
  console.log(`  ${plan.insights} [:DERIVED_INSIGHT] edge(s) deleted, plus every flywheel :Entity left orphaned`);
  console.log('  Physical AST layer (Postgres) untouched.');

  assertConfirmed({
    confirmed,
    flag: '--confirm-strip',
    act: 'stripping annotations deletes every DERIVED_INSIGHT edge in this graph, '
      + 'not only the ones this benchmark wrote.',
  });

  const session = neo4jDriver.session();
  try {
    const cat = await session.run(`MATCH (q:Question) WHERE q.category IS NOT NULL REMOVE q.category RETURN count(q) AS n`);
    console.log(`\n  Removed category from ${cat.records[0].get('n').toNumber()} :Question nodes.`);

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
    console.log('\nGraph is now unannotated — the RLM must classify and cache via write_derived_insight.');
    console.log('   (Restore full annotations any time with: npm run oolong:ingest)');
  } finally {
    await session.close();
  }
  return 0;
}

main()
  .then(async code => {
    await neo4jDriver.close();
    process.exit(code);
  })
  .catch(async err => {
    const refusalCode = reportRefusal(err);
    if (refusalCode === null) {
      console.error(`FLYWHEEL PREP FAILED: ${err instanceof Error ? err.message : err}`);
    }
    await neo4jDriver.close().catch(() => {});
    process.exit(refusalCode ?? 1);
  });
