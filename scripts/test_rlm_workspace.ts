// Wrapper for scripts/test_rlm_workspace.py: the Session 14 zero-LLM
// Tier-3 workspace suite. The registry under test is built with the same
// Node-side Zod helpers config uses and forwarded via TRELLIS_MCP_SERVERS
// exactly as rlm_worker.ts forwards it to a production agent run. The
// only server involved is the local deterministic fixture over stdio
// (the TrellisMcp client spawns it as a child) — no network, no paid
// work, no databases. The workspace bounds ride the same validated-env
// path buildAgentEnv uses.
import { spawn } from 'child_process';
import path from 'path';
import { config } from '../src/config/index';
import { parseMcpServers, serializeMcpServers } from '../src/config/mcp_servers';

const script = path.resolve('scripts/test_rlm_workspace.py');
const fixture = path.resolve('scripts/fixture_mcp_server.py');

// One happy-path surface and one small-cap surface so the drill can pin
// the truncated-capture stamp without a 64 KiB default-cap payload.
const registry = parseMcpServers(JSON.stringify([
  {
    name: 'websearch',
    command: [config.python.executable, fixture],
    tools: ['web_search'],
    timeoutMs: 15_000,
  },
  {
    name: 'smallcap',
    command: [config.python.executable, fixture],
    tools: ['oversized_search'],
    timeoutMs: 15_000,
    maxResultBytes: 512,
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
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  },
});

child.on('error', err => {
  console.error(`Failed to spawn '${config.python.executable}': ${err.message}. Set PYTHON_EXECUTABLE to your interpreter path.`);
  process.exit(1);
});
child.on('close', code => process.exit(code ?? 1));
