import { pgPool, neo4jDriver } from '../src/config/db';
import { DRILL_DOC_KEY } from '../src/benchmarks/oolong/reingest';

// Resets the Update Drill so it can be re-run from Act 1.
//
// Clears the drill doc_key's version history from the registry (so the
// next Act 3 adopts v1 fresh instead of diffing v2 against itself) and
// removes membership rows for those versions. Physical ast_nodes rows
// are content-addressed and shared — they stay.
//
// Restoring the v1 graph state is then the standard two commands:
//   npm run oolong:ingest         (v1 text/provenance/annotations)
//   npm run oolong:flywheel-prep  (strip annotations; cold cache)

async function main(): Promise<void> {
  const docKey = process.argv[2] ?? DRILL_DOC_KEY;
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const roots = (await client.query(
      'SELECT DISTINCT root_hash FROM documents WHERE doc_key = $1', [docKey]
    )).rows.map(r => r.root_hash);
    await client.query('DELETE FROM documents WHERE doc_key = $1', [docKey]);
    // Only drop membership for roots no other doc_key still references.
    const stillUsed = (await client.query(
      'SELECT DISTINCT root_hash FROM documents WHERE root_hash = ANY($1)', [roots]
    )).rows.map(r => r.root_hash);
    const removable = roots.filter(r => !stillUsed.includes(r));
    await client.query('DELETE FROM document_nodes WHERE root_hash = ANY($1)', [removable]);
    await client.query('COMMIT');
    console.log(`Registry cleared for doc_key "${docKey}": ${roots.length} version(s), membership dropped for ${removable.length} root(s).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Drop the drill's semantic leftovers: city-swapped REFERENCES edges
  // from Act 3 would otherwise survive the v1 re-ingest MERGE and fail
  // its mapped-constraint verification (extra edge on swapped records).
  const session = neo4jDriver.session();
  try {
    const refs = await session.run(`MATCH (:Question)-[r:REFERENCES]->(:Concept) DELETE r RETURN count(r) AS n`);
    const insights = await session.run(`MATCH ()-[r:DERIVED_INSIGHT]->() DELETE r RETURN count(r) AS n`);
    const orphans = await session.run(
      `MATCH (e:Entity) WHERE NOT (e)--() AND (e.name =~ 'q_[0-9]+' OR e.sourceNodeIds IS NOT NULL) DELETE e RETURN count(e) AS n`
    );
    console.log(
      `Graph drill-state cleared: ${refs.records[0].get('n').toNumber()} REFERENCES, ` +
      `${insights.records[0].get('n').toNumber()} DERIVED_INSIGHT, ` +
      `${orphans.records[0].get('n').toNumber()} orphaned entities removed.`
    );
  } finally {
    await session.close();
  }

  console.log('\nTo restore the drill-ready v1 graph state, run:');
  console.log('  npm run oolong:ingest');
  console.log('  npm run oolong:flywheel-prep');
}

main()
  .then(async () => {
    await pgPool.end();
    await neo4jDriver.close();
    process.exit(0);
  })
  .catch(async err => {
    console.error(`DRILL RESET FAILED: ${err.message}`);
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(1);
  });
