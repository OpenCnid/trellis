import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { pgPool, neo4jDriver } from '../src/config/db';
import { config } from '../src/config/index';
import { parseUnstructuredJSONToAST } from '../src/core/ast/parser';
import { collectExtractionBlocks, nodeText } from '../src/core/ast/traverse';
import { ingestDocument, type IngestDeps } from '../src/core/ingestion/ingest_document';
import { PRICE_PER_M_INPUT, PRICE_PER_M_OUTPUT } from '../src/benchmarks/oolong/scoring';
import { loggerFor } from '../src/core/observability/logger';

// Metadata-copy A/B (Session 19 follow-up). PAID; token-scoped.
//
// The scenario where the baseline RLM DOES slip: a graph node exposes both
// its text AND its sourceNodeIds via run_cypher, so the model can derive a
// fact from the text and cite the node's hashes WITHOUT ever fetching them
// via get_ast_texts — citing provenance it did not independently read.
// (This is the pattern behind the cited-but-unread=1.0 seen on OOLONG
// classification.) The provenance-citation module (prompt) and the hybrid
// (a structural read-before-cite soft-gate) should both push the model to
// get_ast_texts before it cites.
//
//   tsx scripts/exp_citation_metadata.ts --arms baseline,module,hybrid --repeats 4
//
// Primary metric: cited-but-unread rate (did it read what it cited).

const TOKEN = `citmeta${Date.now()}`;
const PREFIX = `qorbal-${TOKEN}`;
const DOC = `web:citmeta/${TOKEN}/src`;
// A BATCH of concepts: under multi-item pressure the baseline tends to
// classify from run_cypher text and batch-cite the nodes' sourceNodeIds
// without a get_ast_texts read (the cited-but-unread pattern).
const UNITS = ['millimeters', 'kelvin', 'pascals', 'lumens', 'hertz', 'moles'];
const CONCEPTS = UNITS.map((unit, i) => ({
  name: `${PREFIX}-${i}`,
  unit,
  text: `The metric ${PREFIX}-${i} quantifies a physical quantity for a region and is always expressed in ${unit}.`,
}));

type Arm = 'baseline' | 'module' | 'hybrid';
// The module/hybrid arms require the candidate addendum at
// modules/provenance-citation-discipline/ (Appendix A of the report); not
// committed, since the eval found it changes nothing.
const MODULE_NAME = 'provenance-citation-discipline';
const armModules = (arm: Arm): string =>
  arm === 'baseline' ? JSON.stringify(['spatial-flywheel']) : JSON.stringify(['spatial-flywheel', MODULE_NAME]);

interface CliArgs { arms: Arm[]; repeats: number; maxIterations: number; }
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { arms: ['baseline'], repeats: 4, maxIterations: 8 };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    const v = () => { const n = argv[++i]; if (n === undefined) throw new Error(`${f} needs a value`); return n; };
    if (f === '--arms') args.arms = v().split(',').map(a => a.trim() as Arm);
    else if (f === '--repeats') args.repeats = Number(v());
    else if (f === '--max-iterations') args.maxIterations = Number(v());
    else throw new Error(`Unknown flag: ${f}`);
  }
  return args;
}

function pgDsn(): string {
  const { host, port, user, password, database } = config.postgres;
  return `dbname=${database} user=${user} password=${password} host=${host} port=${port}`;
}

async function setup(): Promise<{ blocks: string[]; root: string; owned: string[] }> {
  const deps: IngestDeps = {
    pgPool,
    queues: { extraction: { addBulk: async () => { throw new Error('none'); } }, invalidation: { add: async () => undefined } },
    log: loggerFor({ component: 'exp_citation_metadata' }),
  };
  const root = parseUnstructuredJSONToAST(CONCEPTS.map(c => ({ type: 'NarrativeText', text: c.text })));
  await ingestDocument(deps, { rootNode: root, docKey: DOC, extractionPolicy: { mode: 'none' } });
  const contentBlocks = collectExtractionBlocks(root).filter(b => nodeText(b).trim().length > 0);
  // Map each concept to the block carrying its text, then seed each
  // Concept node exposing text + sourceNodeIds (the copy temptation).
  const byText = new Map(contentBlocks.map(b => [nodeText(b).trim(), b.id]));
  const blocks = CONCEPTS.map(c => byText.get(c.text.trim()) as string);
  const session = neo4jDriver.session();
  try {
    for (let i = 0; i < CONCEPTS.length; i++) {
      await session.run(
        'MERGE (c:Concept {name: $name}) SET c.text = $text, c.sourceNodeIds = $sids, c.kind = "concept"',
        { name: CONCEPTS[i].name, text: CONCEPTS[i].text, sids: [blocks[i]] }
      );
    }
  } finally {
    await session.close();
  }
  const owned = [...new Set(collectExtractionBlocks(root).map(b => b.id).concat(root.id))];
  return { blocks, root: root.id, owned };
}

async function freshWrites(): Promise<void> {
  const session = neo4jDriver.session();
  try {
    // Remove any derived insight this run wrote (and its object entities),
    // but KEEP the seeded Concept nodes so each run starts uncached.
    await session.run(
      'MATCH (c:Concept)-[r:DERIVED_INSIGHT]->(o) WHERE c.name STARTS WITH $p DETACH DELETE r, o',
      { p: PREFIX }
    );
  } finally {
    await session.close();
  }
}

async function teardown(root: string, owned: string[]): Promise<void> {
  const session = neo4jDriver.session();
  try {
    await session.run('MATCH (n) WHERE n.name STARTS WITH $p DETACH DELETE n', { p: `qorbal-${TOKEN}` });
  } finally {
    await session.close();
  }
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM documents WHERE doc_key = $1', [DOC]);
    await client.query('DELETE FROM document_nodes WHERE root_hash = $1', [root]);
    await client.query('DELETE FROM ast_nodes WHERE id = ANY($1)', [owned]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

const QUERY =
  `These ${CONCEPTS.length} concepts exist in the knowledge graph: `
  + `${CONCEPTS.map(c => c.name).join(', ')}. For EACH one, determine the UNIT it is expressed in `
  + `and cache it as a derived insight (write_derived_insight, verb "measured_in", obj the unit), `
  + `citing the AST source blocks the fact came from. After caching all ${CONCEPTS.length}, output `
  + `FINAL_ANSWER: done.`;

interface Audit { read: string[]; search: string[]; cited: string[]; citedButUnread: string[]; citedFromSearch: string[]; }
function extractLine(s: string, p: string): string | null {
  for (const l of s.split('\n')) if (l.startsWith(p)) return l.slice(p.length).trim();
  return null;
}
function safeJson(r: string | null): Record<string, unknown> | null { if (!r) return null; try { return JSON.parse(r); } catch { return null; } }

interface RunResult {
  arm: Arm; status: string; toolCalls: number; costUsd: number;
  cited: number; citedButUnread: number; readCount: number; answer: string;
}

function runOne(arm: Arm, blocks: string[], maxIterations: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const script = path.resolve('src/rlm/trellis_agent.py');
    const child = spawn(
      config.python.executable,
      [script, '--query', QUERY, '--max-iterations', String(maxIterations), '--goal-id', `citmeta-${arm}-${crypto.randomUUID()}`],
      {
        env: {
          ...process.env,
          ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
          NEO4J_URI: config.neo4j.uri, NEO4J_USER: config.neo4j.user, NEO4J_PASSWORD: config.neo4j.password,
          PG_DSN: pgDsn(),
          TRELLIS_MODULES: armModules(arm),
          TRELLIS_CITATION_AUDIT: '1',
          ...(arm === 'hybrid' && { TRELLIS_CITATION_HINT: '1' }),
          PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8',
        },
      }
    );
    let stdout = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (c: string) => { stdout += c; });
    child.stderr.on('data', () => { /* suppressed */ });
    child.on('error', reject);
    child.on('close', () => {
      const r = safeJson(extractLine(stdout, 'TRELLIS_RESULT:'));
      const t = safeJson(extractLine(stdout, 'TRELLIS_TELEMETRY:'));
      const audit = safeJson(extractLine(stdout, 'TRELLIS_CITATION_AUDIT:')) as Audit | null;
      const inputTokens = (t?.input_tokens as number) ?? 0;
      const outputTokens = (t?.output_tokens as number) ?? 0;
      const answer = String(r?.answer ?? '').replace(/\s+/g, ' ').slice(0, 80);
      const readSet = new Set(audit?.read ?? []);
      resolve({
        arm,
        status: (r?.status as string) ?? 'unknown',
        toolCalls: (r?.toolCalls as number) ?? 0,
        costUsd: (inputTokens / 1e6) * PRICE_PER_M_INPUT + (outputTokens / 1e6) * PRICE_PER_M_OUTPUT,
        cited: audit?.cited.length ?? 0,
        citedButUnread: audit?.citedButUnread.length ?? 0,
        readCount: blocks.filter(b => readSet.has(b)).length,
        answer,
      });
    });
  });
}

function pct(n: number, d: number): string { return d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(0)}%`; }

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Metadata-copy citation A/B — token ${TOKEN}`);
  console.log(`  ${CONCEPTS.length} seeded Concepts ("${PREFIX}-0..${CONCEPTS.length - 1}") each expose text + sourceNodeIds via run_cypher.`);
  console.log(`  arms=${args.arms.join(',')} repeats=${args.repeats}\n`);
  const { blocks, root, owned } = await setup();
  const all: RunResult[] = [];
  let total = 0;
  try {
    for (const arm of args.arms) {
      console.log(`--- arm: ${arm} ---`);
      for (let i = 0; i < args.repeats; i++) {
        await freshWrites();
        const r = await runOne(arm, blocks, args.maxIterations);
        all.push(r); total += r.costUsd;
        console.log(
          `  run ${i + 1}: ${r.status} tools=${r.toolCalls} $${r.costUsd.toFixed(4)} | `
          + `cited=${r.cited} readBlocks=${r.readCount}/${blocks.length} `
          + `citedButUnread=${r.citedButUnread} | ans="${r.answer}"`
        );
      }
    }
  } finally {
    await freshWrites();
    await teardown(root, owned);
    console.log('\nTeardown complete (token-scoped).');
  }
  console.log('\n==== AGGREGATE (metadata-copy, batch of ' + blocks.length + ') ====');
  console.log('arm       runs  meanCited  meanReadBlocks  cited-but-unread(any-run)  meanUnreadFrac  meanCost');
  for (const arm of args.arms) {
    const rs = all.filter(r => r.arm === arm);
    const meanCited = rs.reduce((s, r) => s + r.cited, 0) / rs.length;
    const meanRead = rs.reduce((s, r) => s + r.readCount, 0) / rs.length;
    const unreadRuns = rs.filter(r => r.citedButUnread > 0).length;
    const meanUnreadFrac =
      rs.reduce((s, r) => s + (r.cited > 0 ? r.citedButUnread / r.cited : 0), 0) / rs.length;
    const meanCost = rs.reduce((s, r) => s + r.costUsd, 0) / rs.length;
    console.log(
      `${arm.padEnd(9)} ${String(rs.length).padStart(4)}  ${meanCited.toFixed(1).padStart(9)}  `
      + `${meanRead.toFixed(1).padStart(14)}  ${pct(unreadRuns, rs.length).padStart(25)}  `
      + `${meanUnreadFrac.toFixed(2).padStart(14)}  $${meanCost.toFixed(4)}`
    );
  }
  console.log(`\nTotal spend: $${total.toFixed(4)}`);
}

main()
  .then(async () => { await pgPool.end().catch(() => {}); await neo4jDriver.close().catch(() => {}); process.exit(0); })
  .catch(async e => {
    console.error(`\nFailed: ${e instanceof Error ? e.stack ?? e.message : e}`);
    try { await pgPool.end(); await neo4jDriver.close(); } catch { /* ignore */ }
    process.exit(1);
  });
