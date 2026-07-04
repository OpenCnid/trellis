import { execFile } from 'child_process';
import * as path from 'path';
import util from 'util';
import { neo4jDriver } from '../src/config/db';
import { migrateEntityKinds, auditEntityKinds } from '../src/core/graph/entity_kinds';

// Phase 5 Milestone 2 verification: entity namespace separation.
//
//   1. Kind stamping on write, through the REAL Python tools: verb-based
//      inference (has_category, mentions), explicit overrides, the
//      never-downgrade-to-generic rule, and validation.
//   2. The Phase 4 asymmetry fix: re-deriving a contested fact now also
//      un-contests its endpoint NODES — orphaned hashes dropped from
//      node provenance, audit history retained.
//   3. The one-shot migration + read-back audit: rule priority
//      (question > category_label > concept > generic), no overwrite of
//      existing kinds, idempotency, zero unstamped entities afterwards.
//
// NOTE: section 3 runs the real migration against the live graph — that
// is the migration's intended (idempotent) effect; the CLI run of
// scripts/migrate_entity_kinds.ts afterwards should stamp zero nodes.

const execFileAsync = util.promisify(execFile);

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

const TOKEN = `test-kinds-${Date.now()}`;
const SENTINEL_QUESTION = 'q_990001'; // matches the q_\d+ migration rule

const PY_ENV = {
  ...process.env,
  PYTHONPATH: 'C:\\Users\\Darian\\AppData\\Roaming\\Python\\Python313\\site-packages',
  PYTHONIOENCODING: 'utf-8'
};

async function runOpsViaPython(ops: unknown[]): Promise<{ ops: Array<{ ok: boolean; result?: unknown; error?: string }>; tool_calls: number }> {
  const py = [
    'import sys, json',
    "sys.path.insert(0, '.')",
    'from trellis_tools import TrellisNeo4j, get_tool_call_count',
    't = TrellisNeo4j()',
    'out = []',
    'for op in json.loads(sys.argv[1]):',
    '    try:',
    "        if op['op'] == 'single':",
    "            res = t.write_derived_insight(op['subject'], op['verb'], op['obj'], op['sourceNodeIds'], op.get('confidence'), op.get('subject_kind'), op.get('object_kind'))",
    "        elif op['op'] == 'bulk':",
    "            res = t.write_derived_insights(op['facts'])",
    '        else:',
    "            raise ValueError('unknown op')",
    "        out.append({'ok': True, 'result': json.loads(res)})",
    '    except Exception as e:',
    "        out.append({'ok': False, 'error': type(e).__name__ + ': ' + str(e)})",
    't.close()',
    "print(json.dumps({'ops': out, 'tool_calls': get_tool_call_count()}))"
  ].join('\n');
  const { stdout } = await execFileAsync('python', ['-c', py, JSON.stringify(ops)], {
    cwd: path.resolve('src/rlm'),
    env: PY_ENV
  });
  return JSON.parse(stdout.trim().split('\n').pop()!);
}

interface NodeState {
  kind: string | null;
  contested: boolean;
  sourceNodeIds: string[] | null;
  orphanedSourceIds: string[] | null;
  contestedAt: string | null;
  rederivedAt: string | null;
}

async function nodeState(name: string): Promise<NodeState | undefined> {
  const session = neo4jDriver.session();
  try {
    const res = await session.run(
      `MATCH (n:Entity {name: $name})
       RETURN n.kind AS kind,
              coalesce(n.contested, false) AS contested,
              n.sourceNodeIds AS sourceNodeIds,
              n.orphanedSourceIds AS orphanedSourceIds,
              n.contestedAt AS contestedAt,
              n.rederivedAt AS rederivedAt`,
      { name: name.toLowerCase() }
    );
    const rec = res.records[0];
    if (!rec) return undefined;
    return {
      kind: rec.get('kind'),
      contested: rec.get('contested'),
      sourceNodeIds: rec.get('sourceNodeIds'),
      orphanedSourceIds: rec.get('orphanedSourceIds'),
      contestedAt: rec.get('contestedAt') == null ? null : String(rec.get('contestedAt')),
      rederivedAt: rec.get('rederivedAt') == null ? null : String(rec.get('rederivedAt'))
    };
  } finally {
    await session.close();
  }
}

async function run(cypher: string, params: Record<string, unknown> = {}): Promise<void> {
  const session = neo4jDriver.session();
  try {
    await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

async function cleanup(): Promise<void> {
  // Token-prefixed test entities, plus sentinel nodes we created
  // ourselves (marked at creation so a pre-existing 'loc' from the real
  // flywheel cache is never deleted).
  await run(`MATCH (n:Entity) WHERE n.name STARTS WITH $prefix DETACH DELETE n`, { prefix: TOKEN.toLowerCase() });
  await run(`MATCH (n:Concept) WHERE toLower(n.name) STARTS WITH $prefix DETACH DELETE n`, { prefix: TOKEN.toLowerCase() });
  await run(`MATCH (n:Entity) WHERE n._testCreated = $token DETACH DELETE n`, { token: TOKEN });
}

async function main(): Promise<void> {
  console.log('Milestone 2: entity kinds + node-level un-contest + migration');
  const hashA = `${TOKEN}-hash-a`;
  const hashB = `${TOKEN}-hash-b`;

  try {
    // --- 1. Kind stamping on write -----------------------------------------
    console.log('\n[1] kind stamping via the write tools');
    const run1 = await runOpsViaPython([
      { op: 'single', subject: `${TOKEN}-q1`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-loc`, sourceNodeIds: [hashA], confidence: 0.9 },
      { op: 'single', subject: `${TOKEN}-q1`, verb: 'MENTIONS', obj: `${TOKEN}-city`, sourceNodeIds: [hashA] },
      { op: 'single', subject: `${TOKEN}-a`, verb: 'LOCATED_IN', obj: `${TOKEN}-b`, sourceNodeIds: [hashA] },
      { op: 'single', subject: `${TOKEN}-city2`, verb: 'LOCATED_IN', obj: `${TOKEN}-b2`, sourceNodeIds: [hashA], subject_kind: 'concept' },
      { op: 'single', subject: `${TOKEN}-q1`, verb: 'RELATED_TO', obj: `${TOKEN}-b`, sourceNodeIds: [hashA] },
      { op: 'single', subject: `${TOKEN}-q2`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-b`, sourceNodeIds: [hashA] },
      { op: 'single', subject: `${TOKEN}-bad`, verb: 'HAS_CATEGORY', obj: 'x', sourceNodeIds: [hashA], subject_kind: 'city' },
      { op: 'bulk', facts: [{ subject: `${TOKEN}-q3`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-hum`, sourceNodeIds: [hashA], confidence: 0.8, subject_kind: 'question', object_kind: 'category_label' }] }
    ]);
    check('write results', run1.ops.map(o => o.ok), [true, true, true, true, true, true, false, true]);
    check('invalid kind raises with the enum in the message', run1.ops[6].error?.includes('Invalid entity kind'), true);

    check('has_category subject inferred as question', (await nodeState(`${TOKEN}-q1`))?.kind, 'question');
    check('has_category object inferred as category_label', (await nodeState(`${TOKEN}-loc`))?.kind, 'category_label');
    check('mentions object inferred as concept', (await nodeState(`${TOKEN}-city`))?.kind, 'concept');
    check('unknown verb defaults to generic (subject)', (await nodeState(`${TOKEN}-a`))?.kind, 'generic');
    check('explicit subject_kind overrides inference', (await nodeState(`${TOKEN}-city2`))?.kind, 'concept');
    check('RELATED_TO write does NOT downgrade question to generic', (await nodeState(`${TOKEN}-q1`))?.kind, 'question');
    check('later specific write upgrades generic to category_label', (await nodeState(`${TOKEN}-b`))?.kind, 'category_label');
    check('bulk dict facts carry kinds', (await nodeState(`${TOKEN}-q3`))?.kind, 'question');

    // --- 2. Node-level un-contest on re-derive ------------------------------
    console.log('\n[2] node-level un-contest (Phase 4 asymmetry fix)');
    await runOpsViaPython([
      { op: 'single', subject: `${TOKEN}-q9`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-num9`, sourceNodeIds: [hashA], confidence: 0.9 }
    ]);
    // Simulate exactly what sweepOrphanedProvenance does to nodes + edge.
    await run(
      `MATCH (s:Entity {name: $s})-[r:DERIVED_INSIGHT]->(o:Entity {name: $o})
       SET s.contested = true, s.contestedAt = timestamp(), s.orphanedSourceIds = [$orphan],
           o.contested = true, o.contestedAt = timestamp(), o.orphanedSourceIds = [$orphan],
           r.contested = true, r.contestedAt = timestamp(), r.orphanedSourceIds = [$orphan]`,
      { s: `${TOKEN}-q9`.toLowerCase(), o: `${TOKEN}-num9`.toLowerCase(), orphan: hashA }
    );
    const preS = await nodeState(`${TOKEN}-q9`);
    check('setup: subject node is contested', preS?.contested, true);

    await runOpsViaPython([
      { op: 'single', subject: `${TOKEN}-q9`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-num9`, sourceNodeIds: [hashB], confidence: 0.95 }
    ]);
    const s2 = await nodeState(`${TOKEN}-q9`);
    const o2 = await nodeState(`${TOKEN}-num9`);
    check('subject node un-contested after re-derive', s2?.contested, false);
    check('object node un-contested after re-derive', o2?.contested, false);
    check('subject node provenance drops the orphaned hash', s2?.sourceNodeIds, [hashB]);
    check('object node provenance drops the orphaned hash', o2?.sourceNodeIds, [hashB]);
    check('subject node audit history retained', s2?.orphanedSourceIds, [hashA]);
    check('subject node contestedAt retained as audit', s2?.contestedAt != null, true);
    check('subject node rederivedAt is set', s2?.rederivedAt != null, true);

    // --- 3. Migration + read-back audit -------------------------------------
    console.log('\n[3] one-shot migration + audit');
    // Sentinels: created with a marker so cleanup never deletes a
    // pre-existing real node (e.g. 'loc' from the live flywheel cache).
    await run(
      `MERGE (n:Entity {name: $q}) ON CREATE SET n._testCreated = $token`,
      { q: SENTINEL_QUESTION, token: TOKEN }
    );
    await run(`MERGE (n:Entity {name: 'loc'}) ON CREATE SET n._testCreated = $token`, { token: TOKEN });
    await run(
      `MERGE (c:Concept {name: $city})
       MERGE (n:Entity {name: $city}) ON CREATE SET n._testCreated = $token`,
      { city: `${TOKEN}-conceptcity`, token: TOKEN }
    );
    await run(`MERGE (n:Entity {name: $name}) ON CREATE SET n._testCreated = $token`, { name: `${TOKEN}-plain`, token: TOKEN });
    await run(
      `MERGE (n:Entity {name: $name}) ON CREATE SET n._testCreated = $token
       SET n.kind = 'concept'`,
      { name: `${TOKEN}-prestamped`, token: TOKEN }
    );

    const stamped = await migrateEntityKinds(neo4jDriver);
    console.log(`  (stamped: ${JSON.stringify(stamped)})`);
    check('sentinel q_990001 stamped as question', (await nodeState(SENTINEL_QUESTION))?.kind, 'question');
    check("TREC label 'loc' stamped as category_label", (await nodeState('loc'))?.kind, 'category_label');
    check('known-concept entity stamped as concept', (await nodeState(`${TOKEN}-conceptcity`))?.kind, 'concept');
    check('unmatched entity stamped as generic', (await nodeState(`${TOKEN}-plain`))?.kind, 'generic');
    check('pre-existing kind NOT overwritten', (await nodeState(`${TOKEN}-prestamped`))?.kind, 'concept');

    const audit = await auditEntityKinds(neo4jDriver);
    check('read-back audit: zero unstamped entities', audit.unstamped, 0);
    check('read-back audit: totals reconcile', Object.values(audit.counts).reduce((a, b) => a + b, 0), audit.total);

    const second = await migrateEntityKinds(neo4jDriver);
    check('migration is idempotent (second run stamps nothing)', second, { question: 0, category_label: 0, concept: 0, generic: 0 });
  } finally {
    await cleanup();
  }
}

main()
  .then(async () => {
    await neo4jDriver.close();
    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async err => {
    console.error(`\nTest run error: ${err.stack ?? err.message}`);
    try { await neo4jDriver.close(); } catch {}
    process.exit(1);
  });
