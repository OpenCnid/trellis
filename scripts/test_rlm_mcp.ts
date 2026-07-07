// Wrapper for scripts/test_rlm_mcp.py: the Session 10/12 zero-LLM MCP
// live suite. The registry under test is built with the same Node-side
// Zod helpers config uses and forwarded via TRELLIS_MCP_SERVERS exactly
// as rlm_worker.ts forwards it to a production agent run, so the suite
// pins the cross-language contract along the real delivery path. The
// only servers involved are the local deterministic fixture over stdio
// and over Streamable HTTP on 127.0.0.1 — no external network, no paid
// work, no databases.
import { spawn, type ChildProcess } from 'child_process';
import net from 'node:net';
import path from 'path';
import { config } from '../src/config/index';
import { parseMcpServers, serializeMcpServers } from '../src/config/mcp_servers';

const script = path.resolve('scripts/test_rlm_mcp.py');
const fixture = path.resolve('scripts/fixture_mcp_server.py');

// Session 12: the auth fixture requires this bearer token; the client
// side resolves the same value through the registry's valueEnv
// reference. A deliberately wrong value drives the redaction checks.
const FIXTURE_TOKEN = 'fixture-secret-token-3f9a1c';
const WRONG_TOKEN = 'wrong-credential-b7d2e4';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`HTTP fixture on port ${port} did not become reachable`));
        } else {
          setTimeout(attempt, 250);
        }
      });
    };
    attempt();
  });
}

const children: ChildProcess[] = [];

async function main(): Promise<void> {
  const [openPort, authPort] = [await freePort(), await freePort()];
  const spawnFixture = (args: string[], extraEnv: Record<string, string>): ChildProcess => {
    // Fixture output is buffered, not inherited: an aborted HTTP session
    // (the timeout and wrong-credential drills cause them on purpose)
    // makes the server log large benign tracebacks that would bury the
    // check output. Buffered stderr is replayed only if a fixture dies.
    const child = spawn(config.python.executable, [fixture, ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
        PYTHONUNBUFFERED: '1',
        ...extraEnv,
      },
    });
    let stderrTail = '';
    child.stderr!.on('data', chunk => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });
    child.on('close', code => {
      if (code !== null && code !== 0 && !child.killed) {
        console.error(`HTTP fixture exited with code ${code}. stderr tail:\n${stderrTail}`);
      }
    });
    children.push(child);
    return child;
  };

  // Two HTTP fixture processes on loopback: an open one and one that
  // requires a bearer credential (token via env, never argv).
  spawnFixture(['--transport', 'streamable-http', '--port', String(openPort)], {});
  spawnFixture(
    ['--transport', 'streamable-http', '--port', String(authPort), '--auth-token-env', 'FIXTURE_TOKEN'],
    { FIXTURE_TOKEN }
  );
  await Promise.all([waitForPort(openPort), waitForPort(authPort)]);

  // The forwarded registry mixes both transports in one run. Logical
  // servers reuse fixture processes: the stdio pair from Session 10 is
  // unchanged; over HTTP, one happy-path surface, one bounds-testing
  // surface with a short timeout and small cap, and one credentialed
  // surface whose registry entry carries only the env var NAME.
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
    {
      transport: 'http',
      name: 'httpsearch',
      url: `http://127.0.0.1:${openPort}/mcp`,
      tools: ['web_search'],
      timeoutMs: 15_000,
    },
    {
      transport: 'http',
      name: 'httpmisbehaving',
      url: `http://127.0.0.1:${openPort}/mcp`,
      tools: ['slow_search', 'oversized_search'],
      timeoutMs: 2_000,
      maxResultBytes: 512,
    },
    {
      transport: 'http',
      name: 'authsearch',
      url: `http://127.0.0.1:${authPort}/mcp`,
      tools: ['web_search'],
      timeoutMs: 15_000,
      auth: { kind: 'bearer', valueEnv: 'MCP_HTTP_SEARCH_TOKEN' },
    },
  ]));

  const child = spawn(config.python.executable, [script], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
      TRELLIS_MCP_SERVERS: serializeMcpServers(registry)!,
      // The credential the registry references (auth success path)...
      MCP_HTTP_SEARCH_TOKEN: FIXTURE_TOKEN,
      // ...and a wrong value plus the ports, for the failure/redaction
      // registries the Python side constructs locally.
      TRELLIS_TEST_WRONG_TOKEN: WRONG_TOKEN,
      TRELLIS_TEST_HTTP_AUTH_PORT: String(authPort),
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  });

  const code: number = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', c => resolve(c ?? 1));
  });

  for (const fixtureProcess of children) {
    fixtureProcess.kill();
  }
  process.exit(code);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  console.error(`(Python interpreter: '${config.python.executable}' — set PYTHON_EXECUTABLE if this is wrong.)`);
  for (const fixtureProcess of children) {
    fixtureProcess.kill();
  }
  process.exit(1);
});
