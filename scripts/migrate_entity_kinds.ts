import { neo4jDriver } from '../src/config/db';
import { migrateEntityKinds, auditEntityKinds } from '../src/core/graph/entity_kinds';

// Phase 5 Milestone 2: one-shot migration stamping `kind` onto every
// :Entity node written before kinds existed, followed by a read-back
// audit. Idempotent — existing kinds are never overwritten, so a second
// run stamps zero nodes. Exit code 1 if any entity is left unstamped.

async function main(): Promise<void> {
  console.log('Entity kind migration');

  const before = await auditEntityKinds(neo4jDriver);
  console.log(`  before: ${before.total} entities, ${before.unstamped} unstamped, kinds = ${JSON.stringify(before.counts)}`);

  const stamped = await migrateEntityKinds(neo4jDriver);
  console.log(`  stamped: question=${stamped.question} category_label=${stamped.category_label} concept=${stamped.concept} generic=${stamped.generic}`);

  const after = await auditEntityKinds(neo4jDriver);
  console.log(`  after:  ${after.total} entities, ${after.unstamped} unstamped, kinds = ${JSON.stringify(after.counts)}`);

  if (after.unstamped !== 0) {
    throw new Error(`${after.unstamped} entities remain unstamped after migration`);
  }
  console.log('\nMigration complete; read-back audit clean.');
}

main()
  .then(async () => {
    await neo4jDriver.close();
    process.exit(0);
  })
  .catch(async err => {
    console.error(`\nMigration error: ${err.message}`);
    try { await neo4jDriver.close(); } catch {}
    process.exit(1);
  });
