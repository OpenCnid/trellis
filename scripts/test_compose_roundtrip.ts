import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { config } from '../src/config/index.js';
import { neo4jDriver, pgPool } from '../src/config/db.js';

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
const workerMetricsBaseUrl = process.env.WORKER_METRICS_BASE_URL ?? 'http://127.0.0.1:9464';
const token = `ci-roundtrip-${randomUUID()}`;
const documentKey = `${token}-document`;
const subject = `${token}-subject`;
const object = `${token}-object`;
const createdNodeIds: string[] = [];
let rootId: string | undefined;

function apiHeaders(): Record<string, string> {
  return config.api.apiKey ? { 'x-api-key': config.api.apiKey } : {};
}

async function cleanup(): Promise<void> {
  const session = neo4jDriver.session();
  try {
    await session.run(
      'MATCH (n:Entity) WHERE n.id IN $ids DETACH DELETE n',
      { ids: createdNodeIds }
    );
  } finally {
    await session.close();
  }

  if (rootId) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const memberships = await client.query<{ node_id: string }>(
        'SELECT node_id FROM document_nodes WHERE root_hash = $1',
        [rootId]
      );
      const nodeIds = memberships.rows.map(row => row.node_id);
      await client.query('DELETE FROM documents WHERE doc_key = $1', [documentKey]);
      await client.query('DELETE FROM document_nodes WHERE root_hash = $1', [rootId]);
      await client.query('DELETE FROM ast_nodes WHERE id = ANY($1::varchar[])', [nodeIds]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function main(): Promise<void> {
  assert.equal(
    process.env.OPENAI_API_KEY,
    undefined,
    'The deterministic integration service must not receive OPENAI_API_KEY'
  );

  const healthResponse = await fetch(`${apiBaseUrl}/healthz`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { status: 'ok', scope: 'liveness' });
  console.log('[PASS] unauthenticated liveness contract');

  const ingestResponse = await fetch(
    `${apiBaseUrl}/ingest?doc_key=${encodeURIComponent(documentKey)}`,
    {
      method: 'POST',
      headers: {
        ...apiHeaders(),
        'Content-Type': 'text/markdown',
      },
      body: '---\n',
    }
  );
  assert.equal(ingestResponse.status, 202);
  const ingest = await ingestResponse.json() as {
    rootId: string;
    docKey: string;
    version: number;
    blocksQueued: number;
  };
  assert.equal(ingest.docKey, documentKey);
  assert.equal(ingest.version, 1);
  assert.equal(ingest.blocksQueued, 0);
  rootId = ingest.rootId;
  console.log('[PASS] verified ingest queued zero extraction blocks');

  const physical = await pgPool.query<{
    version: number;
    root_hash: string;
    node_id: string;
    node_type: string;
  }>(
    `SELECT d.version, d.root_hash, dn.node_id, n.data->>'type' AS node_type
     FROM documents d
     JOIN document_nodes dn ON dn.root_hash = d.root_hash
     JOIN ast_nodes n ON n.id = dn.node_id
     WHERE d.doc_key = $1
     ORDER BY dn.node_id`,
    [documentKey]
  );
  assert.ok(physical.rows.length >= 2);
  assert.ok(physical.rows.every(row => row.root_hash === rootId));
  assert.ok(physical.rows.some(row => row.node_id === rootId && row.node_type === 'root'));
  console.log('[PASS] PostgreSQL document/root provenance binding');

  const subjectId = randomUUID();
  const objectId = randomUUID();
  createdNodeIds.push(subjectId, objectId);
  const session = neo4jDriver.session();
  try {
    await session.run(
      `CREATE (s:Entity {
         id: $subjectId,
         name: $subject,
         type: 'IntegrationSubject',
         sourceNodeIds: [$sourceNodeId]
       })
       CREATE (o:Entity {
         id: $objectId,
         name: $object,
         type: 'IntegrationObject',
         sourceNodeIds: [$sourceNodeId]
       })
       CREATE (s)-[:ACTION {
         id: $actionId,
         verb: 'references',
         sourceNodeIds: [$sourceNodeId],
         contested: false
       }]->(o)`,
      {
        subjectId,
        objectId,
        subject: subject.toLowerCase(),
        object: object.toLowerCase(),
        actionId: randomUUID(),
        sourceNodeId: rootId,
      }
    );
  } finally {
    await session.close();
  }
  console.log('[PASS] provenance-bearing Neo4j relationship seeded directly');

  const retrieveResponse = await fetch(
    `${apiBaseUrl}/retrieve?entity=${encodeURIComponent(subject)}`,
    { headers: apiHeaders() }
  );
  assert.equal(retrieveResponse.status, 200);
  const retrieval = await retrieveResponse.json() as {
    graph: Array<{ r: { verb: string; sourceNodeIds: string[] } }>;
    provenance: Array<{ id: string; content: string | null }>;
    fallback_active: boolean;
  };
  assert.equal(retrieval.fallback_active, false);
  assert.equal(retrieval.graph.length, 1);
  assert.equal(retrieval.graph[0].r.verb, 'references');
  assert.deepEqual(retrieval.graph[0].r.sourceNodeIds, [rootId]);
  assert.ok(retrieval.provenance.some(row => row.id === rootId));
  console.log('[PASS] API retrieve joined semantic fact to physical provenance');

  // --- T16: API metrics endpoint (authentication, content type, counters) ---
  if (config.api.apiKey) {
    const unauthenticated = await fetch(`${apiBaseUrl}/metrics`);
    assert.equal(unauthenticated.status, 401);
    console.log('[PASS] GET /metrics without key -> 401');
  }
  const metricsResponse = await fetch(`${apiBaseUrl}/metrics`, { headers: apiHeaders() });
  assert.equal(metricsResponse.status, 200);
  assert.ok(
    (metricsResponse.headers.get('content-type') ?? '').includes('text/plain'),
    'metrics exposition must be Prometheus text'
  );
  const metricsText = await metricsResponse.text();
  assert.match(
    metricsText,
    /trellis_http_requests_total\{method="POST",route="\/ingest",status_class="2xx"\} [1-9]/,
    'the deterministic ingest must be visible in API request counters'
  );
  assert.match(
    metricsText,
    /trellis_http_requests_total\{method="GET",route="\/retrieve",status_class="2xx"\} [1-9]/
  );
  console.log('[PASS] authenticated API metrics expose request counters for this round trip');

  // --- T16: worker metrics listener on the internal Compose network ---
  // The workers container publishes no host port; this service reaches it
  // by service DNS. Retry briefly: workers may still be booting.
  let workerMetricsText: string | undefined;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${workerMetricsBaseUrl}/metrics`);
      if (response.status === 200) {
        assert.ok((response.headers.get('content-type') ?? '').includes('text/plain'));
        workerMetricsText = await response.text();
        break;
      }
    } catch {
      // listener not up yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(workerMetricsText, 'worker metrics listener was not reachable on the internal network');
  for (const queue of [
    'extraction_queue',
    'rlm_queue',
    'supervisor_queue',
    'invalidation_queue',
    'verification_queue',
    'resolution_queue',
  ]) {
    assert.match(
      workerMetricsText,
      new RegExp(`trellis_queue_jobs\\{queue="${queue}",state="waiting"\\} \\d`),
      `queue depth gauge missing for ${queue}`
    );
  }
  assert.ok(workerMetricsText.includes('trellis_jobs_total'), 'worker job counters must be registered');
  console.log('[PASS] worker metrics reachable internally with live queue depth gauges');

  const healthAfter = await fetch(`${apiBaseUrl}/healthz`);
  assert.equal(healthAfter.status, 200);
  assert.deepEqual(await healthAfter.json(), { status: 'ok', scope: 'liveness' });
  console.log('[PASS] /healthz contract unchanged after metrics rollout');
}

void main()
  .then(async () => {
    await cleanup();
    await Promise.all([pgPool.end(), neo4jDriver.close()]);
    console.log('Zero-LLM Compose round trip passed.');
  })
  .catch(async error => {
    console.error(error);
    try {
      await cleanup();
      await Promise.all([pgPool.end(), neo4jDriver.close()]);
    } catch (cleanupError) {
      console.error('Integration cleanup failed:', cleanupError);
    }
    process.exitCode = 1;
  });
