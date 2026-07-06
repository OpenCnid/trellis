// Live test of the T6 API protections. Boots the real server on a test
// port with API_KEY set, then probes authentication, body/upload limits,
// and upload-type filtering. Requires the docker-compose stack (Redis +
// Postgres + Neo4j) but makes NO LLM calls and queues NO extraction jobs:
// the authorized ingest uses a lone thematic break (`---`), which hashes
// and persists but produces zero extraction blocks.
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

const PORT = 3213;
const KEY = 'trellis-hardening-test-key';
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
}

async function waitForServer(child: ChildProcess, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) return;
    } catch {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  throw new Error('Server did not start listening in time');
}

async function main() {
  const server = spawn(
    process.execPath,
    [path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs'), path.resolve('src', 'api', 'server.ts')],
    {
      env: { ...process.env, PORT: String(PORT), API_KEY: KEY },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let serverLog = '';
  let serverStdout = '';
  server.stdout?.on('data', d => { serverLog += d.toString(); serverStdout += d.toString(); });
  server.stderr?.on('data', d => { serverLog += d.toString(); });

  try {
    await waitForServer(server);
    console.log('Server is up. Running checks...\n');

    // --- Unauthenticated liveness exception ---
    let res = await fetch(`${BASE}/healthz`);
    const health: any = await res.json();
    check('GET /healthz without key -> 200', res.status === 200, `got ${res.status}`);
    check('GET /healthz is explicitly liveness-only', health.scope === 'liveness',
      `scope=${health.scope}`);

    // --- Authentication ---
    res = await fetch(`${BASE}/retrieve?entity=probe`);
    check('GET /retrieve without key -> 401', res.status === 401, `got ${res.status}`);

    res = await fetch(`${BASE}/retrieve?entity=probe`, { headers: { 'x-api-key': 'wrong-key' } });
    check('GET /retrieve with wrong key -> 401', res.status === 401, `got ${res.status}`);

    res = await fetch(`${BASE}/api/rlm-stream?query=probe`);
    check('GET /api/rlm-stream without key -> 401 (no job enqueued)', res.status === 401, `got ${res.status}`);

    res = await fetch(`${BASE}/ingest`, { method: 'POST', headers: { 'Content-Type': 'text/markdown' }, body: '---\n' });
    check('POST /ingest without key -> 401', res.status === 401, `got ${res.status}`);

    // --- Authorized ingest (zero extraction blocks: thematic break only) ---
    res = await fetch(`${BASE}/ingest?doc_key=api-hardening-probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown', 'x-api-key': KEY },
      body: '---\n',
    });
    const ingestBody: any = res.status === 202 ? await res.json() : {};
    check('POST /ingest with x-api-key -> 202', res.status === 202, `got ${res.status}`);
    check('probe document queues zero extraction jobs', ingestBody.blocksQueued === 0,
      `blocksQueued=${ingestBody.blocksQueued}`);

    // --- Bearer variant ---
    res = await fetch(`${BASE}/ingest?doc_key=api-hardening-probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown', Authorization: `Bearer ${KEY}` },
      body: '---\n',
    });
    check('POST /ingest with Authorization: Bearer -> 202', res.status === 202, `got ${res.status}`);

    // --- Body size limit ---
    const oversize = 'a'.repeat(6 * 1024 * 1024); // default limit is 5 MB
    res = await fetch(`${BASE}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown', 'x-api-key': KEY },
      body: oversize,
    });
    check('POST /ingest with 6 MB body -> 413', res.status === 413, `got ${res.status}`);

    // --- Upload type filter ---
    const form = new FormData();
    form.append('file', new Blob(['not a pdf'], { type: 'text/plain' }), 'notes.txt');
    res = await fetch(`${BASE}/ingest`, { method: 'POST', headers: { 'x-api-key': KEY }, body: form });
    check('POST /ingest with non-PDF upload -> 400', res.status === 400, `got ${res.status}`);

    // --- T16: metrics endpoint authentication and exposition ---
    res = await fetch(`${BASE}/metrics`);
    check('GET /metrics without key -> 401', res.status === 401, `got ${res.status}`);

    res = await fetch(`${BASE}/metrics`, { headers: { 'x-api-key': KEY } });
    const metricsText = res.status === 200 ? await res.text() : '';
    check('GET /metrics with key -> 200', res.status === 200, `got ${res.status}`);
    check('metrics exposition is Prometheus text',
      (res.headers.get('content-type') ?? '').includes('text/plain'),
      `content-type=${res.headers.get('content-type')}`);
    check('request counters include this session\'s authorized ingest',
      /trellis_http_requests_total\{method="POST",route="\/ingest",status_class="2xx"\} [1-9]/.test(metricsText),
      'counter series missing');
    check('401s are counted without leaking paths into labels',
      /trellis_http_requests_total\{method="GET",route="\/retrieve",status_class="4xx"\} [1-9]/.test(metricsText),
      'counter series missing');

    // --- T16: every server stdout line is one parseable JSON object ---
    // (startup banner, request logs, warnings — no human-formatted lines
    // left on the operational path).
    const stdoutLines = serverStdout.split('\n').filter(line => line.trim().length > 0);
    const unparseable = stdoutLines.filter(line => {
      try {
        const parsed = JSON.parse(line);
        return typeof parsed !== 'object' || parsed === null;
      } catch {
        return true;
      }
    });
    check('server stdout is JSON-only during startup and request handling',
      stdoutLines.length > 0 && unparseable.length === 0,
      `${unparseable.length} unparseable of ${stdoutLines.length}: ${unparseable[0]?.slice(0, 120) ?? ''}`);
    const events = stdoutLines.flatMap(line => {
      try { return [JSON.parse(line).event]; } catch { return []; }
    });
    check('startup and request events are present',
      events.includes('api.started') && events.includes('http.request_completed'),
      `events=${events.slice(0, 10).join(',')}`);
  } finally {
    server.kill();
  }

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed. Server log tail:\n${serverLog.slice(-2000)}`);
    process.exit(1);
  }
  console.log('\nAll API hardening checks passed.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
