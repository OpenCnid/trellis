import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import util from 'util';
import { neo4jDriver, pgPool } from '../src/config/db';
import { config } from '../src/config/index';

// Phase 5 Milestone 1 verification: confidence-carrying writes + bulk
// write throughput, exercised through the REAL Python tools
// (trellis_tools.py) — the same code path the RLM agent uses.
//
//   1. Single writes with/without confidence → confidence, rubricVersion,
//      derivedAt stamped correctly.
//   2. Bulk write_derived_insights: mixed dict/tuple facts, one Cypher
//      round trip, ONE tool call for N facts.
//   3. Re-write semantics: absent confidence preserves the stored value,
//      new confidence updates it, derivedAt is first-derivation-only.
//   4. Validation: missing provenance, out-of-range confidence, empty
//      batches all raise.
//   5. Phase 4 parity through the bulk path: a contested edge re-derived
//      via the bulk writer un-quarantines with audit history intact.
//   6. Prompt safety: the agent addendum embeds the versioned rubric with
//      no un-doubled braces (rlms runs .format() over the system prompt).

const execFileAsync = util.promisify(execFile);

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

const TOKEN = `test-confwrites-${Date.now()}`;
const EXPECTED_RUBRIC_VERSION = JSON.parse(
  fs.readFileSync(path.resolve('src/rlm/trec_rubric.json'), 'utf-8')
).version as number;

const PY_ENV = {
  ...process.env,
  ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
  PYTHONIOENCODING: 'utf-8'
};

// Runs a batch of write ops through the real Python tools in one fresh
// interpreter, so get_tool_call_count() counts exactly this batch.
// Returns { ops: [{ok, result|error}], tool_calls }.
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
    "            res = t.write_derived_insight(op['subject'], op['verb'], op['obj'], op['sourceNodeIds'], op.get('confidence'))",
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
  const { stdout } = await execFileAsync(config.python.executable, ['-c', py, JSON.stringify(ops)], {
    cwd: path.resolve('src/rlm'),
    env: PY_ENV
  });
  return JSON.parse(stdout.trim().split('\n').pop()!);
}

// Imports the real agent module and reports on prompt integrity.
async function inspectAgentPrompt(): Promise<{ braces_ok: boolean; rubric_in_prompt: boolean; mentions_bulk: boolean; rubric_version: number }> {
  const py = [
    'import sys, json',
    "sys.path.insert(0, '.')",
    'import trellis_agent',
    'from trellis_tools import RUBRIC_VERSION, RUBRIC_TEXT',
    's = trellis_agent.TRELLIS_ADDENDUM',
    "stripped = s.replace('{{', '').replace('}}', '')",
    'print(json.dumps(dict(',
    "    braces_ok=('{' not in stripped and '}' not in stripped),",
    "    rubric_in_prompt=(RUBRIC_TEXT.replace('{', '{{').replace('}', '}}') in s),",
    "    mentions_bulk=('write_derived_insights' in s),",
    '    rubric_version=RUBRIC_VERSION,',
    ')))'
  ].join('\n');
  const { stdout } = await execFileAsync(config.python.executable, ['-c', py], {
    cwd: path.resolve('src/rlm'),
    env: PY_ENV
  });
  return JSON.parse(stdout.trim().split('\n').pop()!);
}

interface EdgeState {
  confidence: number | null;
  rubricVersion: number | null;
  derivedAt: string | null;
  rederivedAt: string | null;
  contested: boolean;
  sourceNodeIds: string[] | null;
  orphanedSourceIds: string[] | null;
}

async function edgeState(subject: string, verb: string): Promise<EdgeState | undefined> {
  const session = neo4jDriver.session();
  try {
    const res = await session.run(
      `MATCH (s:Entity {name: $name})-[r:DERIVED_INSIGHT {verb: $verb}]->(o:Entity)
       RETURN r.confidence AS confidence,
              r.rubricVersion AS rubricVersion,
              r.derivedAt AS derivedAt,
              r.rederivedAt AS rederivedAt,
              coalesce(r.contested, false) AS contested,
              r.sourceNodeIds AS sourceNodeIds,
              r.orphanedSourceIds AS orphanedSourceIds`,
      { name: subject.toLowerCase(), verb: verb.toLowerCase() }
    );
    const rec = res.records[0];
    if (!rec) return undefined;
    const num = (v: unknown) => (v == null ? null : Number(v));
    return {
      confidence: num(rec.get('confidence')),
      rubricVersion: num(rec.get('rubricVersion')),
      derivedAt: rec.get('derivedAt') == null ? null : String(rec.get('derivedAt')),
      rederivedAt: rec.get('rederivedAt') == null ? null : String(rec.get('rederivedAt')),
      contested: rec.get('contested'),
      sourceNodeIds: rec.get('sourceNodeIds'),
      orphanedSourceIds: rec.get('orphanedSourceIds')
    };
  } finally {
    await session.close();
  }
}

async function cleanup(): Promise<void> {
  const session = neo4jDriver.session();
  try {
    await session.run(`MATCH (n:Entity) WHERE n.name STARTS WITH $prefix DETACH DELETE n`, { prefix: TOKEN.toLowerCase() });
  } finally {
    await session.close();
  }
  await pgPool.query('DELETE FROM ast_nodes WHERE document_id = $1', [`${TOKEN}-root`]);
}

// Session 14 enforces format AND existence on provenance at the write
// path, so the fixture hashes must be real sha256 hex strings that
// exist in ast_nodes (the test_verification_sweep seeding pattern).
const H = (n: string) => crypto.createHash('sha256').update(`${TOKEN}:${n}`).digest('hex');

async function seedAstNode(hash: string): Promise<void> {
  const data = { id: hash, type: 'paragraph', children: [{ id: `${hash}-child`, type: 'text', content: `fixture text ${hash.slice(0, 8)}` }] };
  await pgPool.query(
    `INSERT INTO ast_nodes (id, document_id, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [hash, `${TOKEN}-root`, JSON.stringify(data)]
  );
}

async function main(): Promise<void> {
  console.log('Milestone 1: confidence-carrying writes + bulk throughput');
  const hashA = H('a');
  const hashB = H('b');
  await seedAstNode(hashA);
  await seedAstNode(hashB);

  try {
    // --- 1. Single writes -------------------------------------------------
    console.log('\n[1] single writes');
    const run1 = await runOpsViaPython([
      { op: 'single', subject: `${TOKEN}-q1`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-loc`, sourceNodeIds: [hashA], confidence: 0.93 },
      { op: 'single', subject: `${TOKEN}-q2`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-hum`, sourceNodeIds: [hashA] }
    ]);
    check('both single writes succeed', run1.ops.map(o => o.ok), [true, true]);
    check('two single writes = two tool calls', run1.tool_calls, 2);

    const q1 = await edgeState(`${TOKEN}-q1`, 'HAS_CATEGORY');
    const q2 = await edgeState(`${TOKEN}-q2`, 'HAS_CATEGORY');
    check('q1 stores confidence 0.93', q1?.confidence, 0.93);
    check('q1 stamped with current rubricVersion', q1?.rubricVersion, EXPECTED_RUBRIC_VERSION);
    check('q1 derivedAt is set', q1?.derivedAt != null, true);
    check('q1 not contested', q1?.contested, false);
    check('q2 (no confidence) stores null confidence', q2?.confidence, null);
    check('q2 still stamped with rubricVersion', q2?.rubricVersion, EXPECTED_RUBRIC_VERSION);

    // --- 2. Bulk write: mixed dict/tuple forms, one tool call -------------
    console.log('\n[2] bulk write');
    const run2 = await runOpsViaPython([
      {
        op: 'bulk',
        facts: [
          { subject: `${TOKEN}-q3`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-num`, sourceNodeIds: [hashA], confidence: 0.88 },
          { subject: `${TOKEN}-q4`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-desc`, sourceNodeIds: [hashA], confidence: 0.0 },
          [`${TOKEN}-q5`, 'HAS_CATEGORY', `${TOKEN}-enty`, [hashA], 0.75],
          [`${TOKEN}-q6`, 'HAS_CATEGORY', `${TOKEN}-abbr`, [hashA]],
          { subject: `${TOKEN}-q7`, verb: 'MENTIONS', obj: `${TOKEN}-city`, sourceNodeIds: [hashA, hashB] }
        ]
      }
    ]);
    check('bulk write succeeds', run2.ops[0].ok, true);
    check('bulk write returns 5 rows', (run2.ops[0].result as unknown[]).length, 5);
    check('bulk write of 5 facts = ONE tool call', run2.tool_calls, 1);

    const q4 = await edgeState(`${TOKEN}-q4`, 'HAS_CATEGORY');
    const q5 = await edgeState(`${TOKEN}-q5`, 'HAS_CATEGORY');
    const q6 = await edgeState(`${TOKEN}-q6`, 'HAS_CATEGORY');
    const q7 = await edgeState(`${TOKEN}-q7`, 'MENTIONS');
    check('bulk: confidence 0.0 stored as 0.0 (not dropped as null)', q4?.confidence, 0);
    check('bulk: 5-tuple form carries confidence', q5?.confidence, 0.75);
    check('bulk: 4-tuple form stores null confidence', q6?.confidence, null);
    check('bulk: multi-hash provenance lands on the edge', q7?.sourceNodeIds, [hashA, hashB]);
    check('bulk: rubricVersion stamped', q5?.rubricVersion, EXPECTED_RUBRIC_VERSION);

    // --- 3. Re-write semantics --------------------------------------------
    console.log('\n[3] re-write semantics');
    const run3 = await runOpsViaPython([
      { op: 'single', subject: `${TOKEN}-q1`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-loc`, sourceNodeIds: [hashA] },
      { op: 'single', subject: `${TOKEN}-q2`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-hum`, sourceNodeIds: [hashA], confidence: 0.4 }
    ]);
    check('re-writes succeed', run3.ops.map(o => o.ok), [true, true]);
    const q1b = await edgeState(`${TOKEN}-q1`, 'HAS_CATEGORY');
    const q2b = await edgeState(`${TOKEN}-q2`, 'HAS_CATEGORY');
    check('re-write WITHOUT confidence preserves stored 0.93', q1b?.confidence, 0.93);
    check('re-write WITH confidence updates null → 0.4', q2b?.confidence, 0.4);
    check('derivedAt is first-derivation-only (unchanged)', q1b?.derivedAt, q1?.derivedAt);
    check('uncontested re-write does not set rederivedAt', q1b?.rederivedAt, null);

    // --- 4. Validation ------------------------------------------------------
    console.log('\n[4] validation');
    const run4 = await runOpsViaPython([
      { op: 'single', subject: `${TOKEN}-bad1`, verb: 'HAS_CATEGORY', obj: 'x', sourceNodeIds: [] },
      { op: 'single', subject: `${TOKEN}-bad2`, verb: 'HAS_CATEGORY', obj: 'x', sourceNodeIds: [hashA], confidence: 1.5 },
      { op: 'bulk', facts: [] },
      { op: 'bulk', facts: [[`${TOKEN}-bad3`, 'HAS_CATEGORY', 'x']] }
    ]);
    check('empty sourceNodeIds raises', run4.ops[0].ok, false);
    check('provenance violation names the cause', run4.ops[0].error?.includes('Provenance Violation'), true);
    check('confidence > 1.0 raises', run4.ops[1].ok, false);
    check('empty bulk batch raises', run4.ops[2].ok, false);
    check('3-tuple fact raises', run4.ops[3].ok, false);
    check('no bad edges were written', await edgeState(`${TOKEN}-bad1`, 'HAS_CATEGORY') ?? await edgeState(`${TOKEN}-bad2`, 'HAS_CATEGORY') ?? await edgeState(`${TOKEN}-bad3`, 'HAS_CATEGORY'), undefined);

    // --- 5. Phase 4 parity: bulk re-derive clears quarantine ----------------
    console.log('\n[5] quarantine round trip via bulk writer');
    const session = neo4jDriver.session();
    try {
      // Simulate what the Phase 4 sweep (or the Phase 5 verifier) does:
      // contest the edge and record the orphaned provenance.
      await session.run(
        `MATCH (s:Entity {name: $name})-[r:DERIVED_INSIGHT]->(:Entity)
         SET r.contested = true,
             r.orphanedSourceIds = coalesce(r.orphanedSourceIds, []) + $orphaned`,
        { name: `${TOKEN}-q3`.toLowerCase(), orphaned: [hashA] }
      );
    } finally {
      await session.close();
    }
    const run5 = await runOpsViaPython([
      {
        op: 'bulk',
        facts: [{ subject: `${TOKEN}-q3`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-num`, sourceNodeIds: [hashB], confidence: 0.97 }]
      }
    ]);
    check('bulk re-derive succeeds', run5.ops[0].ok, true);
    const q3b = await edgeState(`${TOKEN}-q3`, 'HAS_CATEGORY');
    check('re-derived edge no longer contested', q3b?.contested, false);
    check('re-derived edge carries ONLY live provenance', q3b?.sourceNodeIds, [hashB]);
    check('audit history retained (orphanedSourceIds)', q3b?.orphanedSourceIds, [hashA]);
    check('rederivedAt is set', q3b?.rederivedAt != null, true);
    check('confidence refreshed on re-derive', q3b?.confidence, 0.97);

    // --- 6. Agent prompt integrity ------------------------------------------
    console.log('\n[6] agent prompt integrity');
    const prompt = await inspectAgentPrompt();
    check('addendum has no un-doubled braces (rlms .format() safety)', prompt.braces_ok, true);
    check('versioned rubric text is embedded in the addendum', prompt.rubric_in_prompt, true);
    check('addendum documents the bulk write tool', prompt.mentions_bulk, true);
    check('module rubric version matches trec_rubric.json', prompt.rubric_version, EXPECTED_RUBRIC_VERSION);
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
