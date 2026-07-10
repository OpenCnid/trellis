import { neo4jDriver, pgPool } from '../src/config/db';
import { runEffectiveContextCli } from '../src/benchmarks/effective_context/runner';

runEffectiveContextCli(process.argv.slice(2))
  .then(async code => {
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(code);
  })
  .catch(async error => {
    console.error(`Effective-context probe failed: ${error instanceof Error ? error.message : String(error)}`);
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(1);
  });
