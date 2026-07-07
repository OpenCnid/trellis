// Wrapper for scripts/test_rlm_mcp.py: the Session 10 zero-LLM MCP live
// suite. The registry under test is built with the same Node-side Zod
// helpers config uses and forwarded via TRELLIS_MCP_SERVERS exactly as
// rlm_worker.ts forwards it to a production agent run, so the suite pins
// the cross-language contract along the real delivery path. The only
// server involved is the local deterministic fixture — no network, no
// paid work, no databases.
import { spawn } from 'child_process';
import path from 'path';
import { config } from '../src/config/index';
import { parseMcpServers, serializeMcpServers } from '../src/config/mcp_servers';

const script = path.resolve('scripts/test_rlm_mcp.py');
const fixture = path.resolve('scripts/fixture_mcp_server.py');

// Two logical servers over the same fixture process: a happy-path search
// surface (which deliberately does NOT allowlist the misbehaving tools
// the process also exposes) and a bounds-testing surface with a short
// timeout and a small size cap.
const registry = parseMcpServers(JSON.stringify([
  {
    name: 'websearch',
    command: [config.python.executable, fixture],
    tools: ['web_search'],
    timeoutMs: 15_000,
  },
  {
    name: 'misbehaving',
    command: [config.python.executable, fixture],
    tools: ['slow_search', 'oversized_search'],
    timeoutMs: 2_000,
    maxResultBytes: 512,
  },
]));

const child = spawn(config.python.executable, [script], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
    TRELLIS_MCP_SERVERS: serializeMcpServers(registry)!,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  },
});

child.on('error', err => {
  console.error(`Failed to spawn '${config.python.executable}': ${err.message}. Set PYTHON_EXECUTABLE to your interpreter path.`);
  process.exit(1);
});
child.on('close', code => process.exit(code ?? 1));
