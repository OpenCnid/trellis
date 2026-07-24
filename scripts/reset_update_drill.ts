import { pgPool, neo4jDriver } from '../src/config/db';
import { DRILL_DOC_KEY } from '../src/benchmarks/oolong/reingest';
import {
  assertConfirmed,
  assertDrillTarget,
  liveMarkerReaders,
  printTargetBanner,
  reportRefusal,
} from '../src/core/runtime/drill_target';

// Resets the Update Drill so it can be re-run from Act 1.
//
//   npm run drill:reset                            (plan only)
//   npm run drill:reset -- --confirm-reset         (reset)
//   npm run drill:reset -- --doc-key <k> --confirm-reset
//
// Clears the drill doc_key's version history from the registry (so the
// next Act 3 adopts v1 fresh instead of diffing v2 against itself) and
// removes membership rows for those versions. Physical ast_nodes rows
// are content-addressed and shared — they stay.
//
// The graph half is UNSCOPED: it deletes every REFERENCES edge from
// every :Question and every DERIVED_INSIGHT edge in the database, not
// only the drill's own. The registry half takes a doc_key, and any
// doc_key is accepted — `--doc-key repo:trellis-engine` would drop a
// real repository snapshot's whole version history. Both halves refuse
// unless the databases carry a drill-target marker AND the echoed plan
// below was confirmed.
//
// Restoring the v1 graph state is then the standard two commands:
//   npm run oolong:ingest         (v1 text/provenance/annotations)
//   npm run oolong:flywheel-prep  (strip annotations; cold cache)

interface CliArgs {
  docKey: string;
  confirmReset: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { docKey: DRILL_DOC_KEY, confirmReset: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--doc-key': {
        const next = argv[++i];
        if (next === undefined) throw new Error('--doc-key requires a value');
        args.docKey = next;
        break;
      }
      case '--confirm-reset': args.confirmReset = true; break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

async function countPlan(docKey: string): Promise<Record<string, number>> {
  const versions = await pgPool.query(
    'SELECT count(DISTINCT root_hash)::int AS n FROM documents WHERE doc_key = $1',
    [docKey]
  );
  const session = neo4jDriver.session();
  try {
    const result = await session.executeRead(tx =>
      tx.run(
        `RETURN COUNT { MATCH (:Question)-[r:REFERENCES]->(:Concept) } AS references,
                COUNT { MATCH ()-[d:DERIVED_INSIGHT]->() } AS insights`
      )
    );
    const record = result.records[0];
    return {
      versions: versions.rows[0].n,
      references: record.get('references').toNumber(),
      insights: record.get('insights').toNumber(),
    };
  } finally {
    await session.close();
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  const markers = await assertDrillTarget(['neo4j', 'postgres'], liveMarkerReaders(neo4jDriver, pgPool));
  printTargetBanner(['neo4j', 'postgres'], markers);

  const plan = await countPlan(args.docKey);
  console.log('\nThis will delete:');
  console.log(`  registry: ${plan.versions} version(s) of doc_key "${args.docKey}"`
    + `${args.docKey === DRILL_DOC_KEY ? ' (the drill default)' : ' — NOT the drill default'}`);
  console.log(`  graph:    ${plan.references} [:REFERENCES] edge(s), GRAPH-WIDE`);
  console.log(`  graph:    ${plan.insights} [:DERIVED_INSIGHT] edge(s), GRAPH-WIDE`);
  console.log('  Physical ast_nodes rows are content-addressed and shared — they stay.');

  assertConfirmed({
    confirmed: args.confirmReset,
    flag: '--confirm-reset',
    act: `resetting drops the version history of doc_key "${args.docKey}" and every `
      + 'REFERENCES / DERIVED_INSIGHT edge in this graph.',
  });

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const roots = (await client.query(
      'SELECT DISTINCT root_hash FROM documents WHERE doc_key = $1', [args.docKey]
    )).rows.map(r => r.root_hash);
    await client.query('DELETE FROM documents WHERE doc_key = $1', [args.docKey]);
    // Only drop membership for roots no other doc_key still references.
    const stillUsed = (await client.query(
      'SELECT DISTINCT root_hash FROM documents WHERE root_hash = ANY($1)', [roots]
    )).rows.map(r => r.root_hash);
    const removable = roots.filter(r => !stillUsed.includes(r));
    await client.query('DELETE FROM document_nodes WHERE root_hash = ANY($1)', [removable]);
    await client.query('COMMIT');
    console.log(`\nRegistry cleared for doc_key "${args.docKey}": ${roots.length} version(s), membership dropped for ${removable.length} root(s).`);
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
  console.log('  npm run oolong:flywheel-prep -- --confirm-strip');
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
      console.error(`DRILL RESET FAILED: ${err instanceof Error ? err.message : err}`);
    }
    await Promise.allSettled([pgPool.end(), neo4jDriver.close()]);
    process.exit(refusalCode ?? 1);
  });
