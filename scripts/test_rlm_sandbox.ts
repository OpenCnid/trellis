// Wrapper for scripts/test_rlm_sandbox.py: spawns the Python sandbox test
// with the same validated-config env forwarding rlm_worker.ts uses, so the
// test exercises exactly the connection setup production uses.
import { spawn } from 'child_process';
import path from 'path';
import { config, pgDsn } from '../src/config/index';

const script = path.resolve('scripts/test_rlm_sandbox.py');

const child = spawn(config.python.executable, [script], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
    NEO4J_URI: config.neo4j.uri,
    NEO4J_USER: config.neo4j.user,
    NEO4J_PASSWORD: config.neo4j.password,
    PG_DSN: pgDsn(),
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  },
});

child.on('error', err => {
  console.error(`Failed to spawn '${config.python.executable}': ${err.message}. Set PYTHON_EXECUTABLE to your interpreter path.`);
  process.exit(1);
});
child.on('close', code => process.exit(code ?? 1));
