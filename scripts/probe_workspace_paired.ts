// Wrapper for scripts/probe_workspace_paired.py — the design-record §11
// step-1 paired-run behavioral probe. PAID: requires OPENAI_API_KEY and
// makes real LLM calls (owner-approved). Deliberately has no npm script
// alias and is not part of any acceptance suite; run explicitly with
// `tsx scripts/probe_workspace_paired.ts`. The only MCP server involved
// is the local deterministic fixture over stdio.
import { spawn } from 'child_process';
import path from 'path';
import { config } from '../src/config/index';
import { parseMcpServers, serializeMcpServers } from '../src/config/mcp_servers';

const script = path.resolve('scripts/probe_workspace_paired.py');
const fixture = path.resolve('scripts/fixture_mcp_server.py');

const registry = parseMcpServers(JSON.stringify([
  {
    name: 'archive',
    command: [config.python.executable, fixture],
    tools: ['archive_search'],
    timeoutMs: 15_000,
  },
]));

const child = spawn(config.python.executable, [script], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
    TRELLIS_MCP_SERVERS: serializeMcpServers(registry)!,
    TRELLIS_WORKSPACE_MAX_SEGMENTS: String(config.workspace.maxSegments),
    TRELLIS_WORKSPACE_MAX_BYTES: String(config.workspace.maxBytes),
    NEO4J_URI: config.neo4j.uri,
    NEO4J_USER: config.neo4j.user,
    NEO4J_PASSWORD: config.neo4j.password,
    PG_DSN: `dbname=${config.postgres.database} user=${config.postgres.user} password=${config.postgres.password} host=${config.postgres.host} port=${config.postgres.port}`,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  },
});

child.on('error', err => {
  console.error(`Failed to spawn '${config.python.executable}': ${err.message}.`);
  process.exit(1);
});
child.on('close', code => process.exit(code ?? 1));
