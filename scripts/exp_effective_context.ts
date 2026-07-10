import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pgPool } from '../src/config/db';
import { config, pgDsn } from '../src/config/index';
import { parseMarkdownToAST, type ASTNode } from '../src/core/ast/parser';
import { collectExtractionBlocks, nodeText } from '../src/core/ast/traverse';
import { ingestDocument, type IngestDeps } from '../src/core/ingestion/ingest_document';
import { PRICE_PER_M_INPUT, PRICE_PER_M_OUTPUT } from '../src/benchmarks/oolong/scoring';
import { extractIterations } from '../src/benchmarks/oolong/rlm_client';
import {
  answerContainsSentence,
  countOccurrences,
  extractAnswerInteger,
  extractAnswerSection,
  normalizeWhitespace,
  sectionContaining,
  sentenceContaining,
} from '../src/benchmarks/effective_context/ground_truth';
import { loggerFor } from '../src/core/observability/logger';

// The effective-context probe (Session 21; pillar §6.3 of
// docs/architecture/CODE_MEDIATED_TEXT.md). PAID in its run mode; the
// --ingest mode is zero-paid setup. Extends the paired-run series
// (WORKSPACE_PROBE_REPORT.md, WORKSPACE_LINEAGE_PROBE_REPORT.md,
// exp_citation_ab.ts). Report:
// docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md.
//
// The corpus is the committed data/frankenstein.txt — Project Gutenberg
// #84 (the 1831 text, public domain), trimmed deterministically: CRLF
// normalized to LF, everything strictly between the '*** START OF THE
// PROJECT GUTENBERG EBOOK ... ***' and '*** END OF ... ***' marker
// lines, blank edge lines dropped, single trailing newline. Ground
// truth is COMPUTED from those committed bytes at run time (the
// ground_truth helpers, unit-pinned) — never hand-typed.
//
// Arms (paired; identical kernel-fixed questions, identical addressing):
//   on  = today's default composed prompt — the pinned kernel
//         (COMPOSED_SYSTEM_PROMPT_SHA256, test:modules [4]).
//   off = the same run with TRELLIS_EXP_OMIT_CMT=1 in the spawn env:
//         exactly the §6.2 CODE-MEDIATED TEXT block absent, which is
//         byte-identical to the recorded pre-Session-20 kernel
//         (test:modules [7]). The flag exists only here: no default,
//         worker, or Compose configuration sets it, and buildAgentEnv
//         strips it (rlm_job.test.ts).
//
// Metrics per run: correctness against computed truth; input tokens
// (the bytes-through-attention proxy); output tokens; REPL iterations
// (rlms banner); subcall_count; database tool calls; spend. The runs
// write no derived insights — they are read-only questions over Tier-1
// substrate.
//
//   tsx scripts/exp_effective_context.ts --ingest        (zero-paid setup + verify)
//   tsx scripts/exp_effective_context.ts                 (plan + estimate only)
//   tsx scripts/exp_effective_context.ts --confirm-paid  (the paid probe)

const DOC_KEY = 'book:gutenberg-84:frankenstein';
const CORPUS_PATH = path.resolve('data', 'frankenstein.txt');
// Read-load-compute-answer fits comfortably; matches exp_citation_ab.
const MAX_ITERATIONS_DEFAULT = 8;
// The standing per-run spend ceiling (operator policy, July 9, 2026).
const DEFAULT_MAX_SPEND_USD = 5;

type Arm = 'on' | 'off';

interface CliArgs {
  ingest: boolean;
  confirmPaid: boolean;
  arms: Arm[];
  maxIterations: number;
  maxSpendUsd: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    ingest: false,
    confirmPaid: false,
    arms: ['on', 'off'],
    maxIterations: MAX_ITERATIONS_DEFAULT,
    maxSpendUsd: DEFAULT_MAX_SPEND_USD,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} requires a value`);
      return next;
    };
    switch (flag) {
      case '--ingest': args.ingest = true; break;
      case '--confirm-paid': args.confirmPaid = true; break;
      case '--arms':
        args.arms = value().split(',').map(a => {
          const arm = a.trim();
          if (arm !== 'on' && arm !== 'off') throw new Error(`Unknown arm: ${arm}`);
          return arm;
        });
        break;
      case '--max-iterations': args.maxIterations = Number(value()); break;
      case '--max-spend-usd': {
        const parsed = Number(value());
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error('--max-spend-usd must be a positive number');
        }
        args.maxSpendUsd = parsed;
        break;
      }
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

// --- The kernel-fixed question set (Guardrail 5: never env-tunable) --------
// Three kinds over the same corpus: occurrence counting (exactly the
// arithmetic the discipline delegates to code), exact-quote retrieval
// (byte fidelity — the transcription channel), and localization
// (engine-addressed position work). Expected answers are computed from
// the committed corpus by the pinned helpers at startup.

interface ProbeQuestion {
  id: string;
  kind: 'count' | 'quote' | 'locate';
  question: string;
  expected: string;
  isCorrect(answer: string): boolean;
}

const COUNT_NEEDLES = ['Justine', 'Ingolstadt'] as const;
const QUOTE_PHRASES = ['the beauty of the dream vanished', 'borne away by the waves'] as const;
const LOCATE_PHRASES = [
  'It was on a dreary night of November',
  'apparently of gigantic stature',
] as const;

function buildQuestions(corpus: string, rootHash: string): ProbeQuestion[] {
  const preamble =
    `The 1831 text of the novel "Frankenstein; or, The Modern Prometheus" is stored in the `
    + `AST database as one document (doc key ${DOC_KEY}). The hash of its root AST node is `
    + `${rootHash}. Calling trellis_postgres.get_ast_texts with that hash returns the full `
    + `document text, reconstructed by concatenating its paragraph blocks in order (paragraph `
    + `boundaries are unmarked; line breaks inside paragraphs are preserved). `;

  const questions: ProbeQuestion[] = [];
  for (const needle of COUNT_NEEDLES) {
    const expected = String(countOccurrences(corpus, needle));
    questions.push({
      id: `count-${needle.toLowerCase()}`,
      kind: 'count',
      question:
        `${preamble}QUESTION: How many times does the exact character sequence "${needle}" `
        + `occur in the document text? Count case-sensitively; every occurrence counts, `
        + `including inside possessives. Output FINAL_ANSWER: <integer>.`,
      expected,
      isCorrect: answer => extractAnswerInteger(answer) === Number(expected),
    });
  }
  for (const phrase of QUOTE_PHRASES) {
    const expected = sentenceContaining(corpus, phrase);
    questions.push({
      id: `quote-${phrase.split(' ').slice(-1)[0]}`,
      kind: 'quote',
      question:
        `${preamble}QUESTION: Quote the single complete sentence of the document that contains `
        + `the phrase "${phrase}", exactly as it appears in the document text. `
        + `Output FINAL_ANSWER: <the sentence>.`,
      expected,
      isCorrect: answer => answerContainsSentence(answer, expected),
    });
  }
  for (const phrase of LOCATE_PHRASES) {
    const expected = sectionContaining(corpus, phrase);
    questions.push({
      id: `locate-${phrase.split(' ').slice(-1)[0]}`,
      kind: 'locate',
      question:
        `${preamble}QUESTION: The document is structured as sections introduced by the headings `
        + `"Letter 1" through "Letter 4" and then "Chapter 1" through "Chapter 24" (a table of `
        + `contents near the start of the text also lists them). In which section does the `
        + `phrase "${phrase}" appear? Output FINAL_ANSWER: <Letter N or Chapter N>.`,
      expected,
      isCorrect: answer => extractAnswerSection(answer) === expected,
    });
  }
  return questions;
}

// --- Corpus plumbing --------------------------------------------------------

function ingestDeps(): IngestDeps {
  return {
    pgPool,
    queues: {
      extraction: { addBulk: async () => { throw new Error('no extraction under policy none'); } },
      invalidation: { add: async () => undefined },
    },
    log: loggerFor({ component: 'exp_effective_context' }),
  };
}

async function currentRoot(): Promise<{ rootHash: string; version: number }> {
  const res = await pgPool.query(
    'SELECT root_hash, version FROM documents WHERE doc_key = $1 ORDER BY version DESC LIMIT 1',
    [DOC_KEY]
  );
  if (res.rows.length === 0) {
    throw new Error(
      `No document under '${DOC_KEY}'. Run --ingest first (zero-paid) to load the committed corpus.`
    );
  }
  return { rootHash: res.rows[0].root_hash, version: res.rows[0].version };
}

async function readRootNode(rootHash: string): Promise<ASTNode> {
  const res = await pgPool.query('SELECT data FROM ast_nodes WHERE id = $1', [rootHash]);
  if (res.rows.length === 0) throw new Error(`Root ${rootHash} missing from ast_nodes.`);
  return res.rows[0].data as ASTNode;
}

/**
 * The truth must be representation-invariant: the answers computed from
 * the committed file must hold over the text the agent actually reads
 * back (the root reconstruction, which drops blank lines between
 * paragraphs). A mismatch is a question-design error and refuses the
 * probe — never something a run gets scored against.
 */
function assertRepresentationInvariant(corpus: string, reconstruction: string): void {
  for (const needle of COUNT_NEEDLES) {
    const fromFile = countOccurrences(corpus, needle);
    const fromDb = countOccurrences(reconstruction, needle);
    if (fromFile !== fromDb) {
      throw new Error(
        `Count truth for "${needle}" differs between the committed file (${fromFile}) and the `
        + `stored reconstruction (${fromDb}); redesign the question.`
      );
    }
  }
  const normalized = normalizeWhitespace(reconstruction);
  for (const phrase of [...QUOTE_PHRASES, ...LOCATE_PHRASES]) {
    const hits = countOccurrences(normalized, normalizeWhitespace(phrase));
    if (hits !== 1) {
      throw new Error(
        `Phrase "${phrase}" occurs ${hits} time(s) in the stored reconstruction (expected 1); `
        + 'redesign the question.'
      );
    }
  }
}

// --- The zero-paid setup mode (--ingest) ------------------------------------

/** Spawns the REAL Python tool surface to read sampled blocks back. */
function readBlocksViaPythonTool(hashes: string[]): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const code =
      'import sys, json; sys.path.insert(0, sys.argv[1]); '
      + 'from trellis_tools import TrellisPostgres; '
      + 'tool = TrellisPostgres(); '
      + 'print("BLOCK_TEXTS: " + tool.get_ast_texts(json.loads(sys.argv[2]))); '
      + 'tool.close()';
    const child = spawn(
      config.python.executable,
      ['-c', code, path.resolve('src', 'rlm'), JSON.stringify(hashes)],
      {
        env: {
          ...process.env,
          ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
          PG_DSN: pgDsn(),
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (c: string) => { stdout += c; });
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (c: string) => { stderr += c; });
    child.on('error', reject);
    child.on('close', code_ => {
      const line = stdout.split('\n').find(l => l.startsWith('BLOCK_TEXTS: '));
      if (code_ !== 0 || !line) {
        reject(new Error(`python get_ast_texts probe failed (exit ${code_}): ${stderr.slice(0, 400)}`));
        return;
      }
      resolve(JSON.parse(line.slice('BLOCK_TEXTS: '.length)));
    });
  });
}

async function runIngest(): Promise<void> {
  const corpus = fs.readFileSync(CORPUS_PATH, 'utf-8');
  console.log(`Corpus: ${CORPUS_PATH} (${Buffer.byteLength(corpus, 'utf8')} bytes)`);
  const root = parseMarkdownToAST(corpus);
  const result = await ingestDocument(ingestDeps(), {
    rootNode: root,
    docKey: DOC_KEY,
    extractionPolicy: { mode: 'none' },
  });
  console.log(
    `Ingested '${result.docKey}' version ${result.version}: root ${result.rootId}, `
    + `${result.totalNodes} nodes, ${result.blocksEligible} extraction-eligible blocks, `
    + `policy ${result.extractionPolicy} (0 queued).`
  );
  console.log(
    result.diff
      ? `Merkle diff vs prior version: added ${result.diff.added}, orphaned ${result.diff.orphaned}, `
        + `retained ${result.diff.retained}${result.diff.added === 0 && result.diff.orphaned === 0
          ? ' — the auditable no-op (byte-identical re-ingest).' : '.'}`
      : 'First version: no prior version to diff against.'
  );

  // Read-back verification through the REAL Python tool surface: the
  // same get_ast_texts the probe runs will call must return the exact
  // block bytes the parser derived.
  const storedRoot = await readRootNode(result.rootId);
  const blocks = collectExtractionBlocks(storedRoot).filter(b => nodeText(b).trim().length > 0);
  const samples = [blocks[0], blocks[Math.floor(blocks.length / 2)], blocks[blocks.length - 1]];
  const viaTool = await readBlocksViaPythonTool(samples.map(b => b.id));
  for (const block of samples) {
    const match = viaTool[block.id] === nodeText(block);
    console.log(
      `  get_ast_texts(${block.id.slice(0, 12)}…): ${match ? 'OK' : 'MISMATCH'} `
      + `(${Buffer.byteLength(viaTool[block.id] ?? '', 'utf8')} bytes: `
      + `"${normalizeWhitespace(viaTool[block.id] ?? '').slice(0, 60)}…")`
    );
    if (!match) throw new Error(`get_ast_texts returned wrong bytes for ${block.id}`);
  }

  // The truth-representation invariant, checked at setup so a failure
  // is a loud setup error, not a probe-day surprise.
  assertRepresentationInvariant(corpus, nodeText(storedRoot));
  console.log('Representation invariant holds: file truths = stored-reconstruction truths.');
  console.log('\nRe-run --ingest to observe the auditable no-op (new version, empty diff, 0 queued).');
}

// --- The paid probe ---------------------------------------------------------

interface RunRow {
  arm: Arm;
  questionId: string;
  kind: ProbeQuestion['kind'];
  status: string;
  correct: boolean;
  inputTokens: number;
  outputTokens: number;
  iterations: number | null;
  subcalls: number;
  toolCalls: number;
  costUsd: number;
  answer: string;
}

function extractLine(stdout: string, prefix: string): string | null {
  for (const line of stdout.split('\n')) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return null;
}

function safeJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * The spawn environment: exactly the pinned default kernel for the on
 * arm, plus TRELLIS_EXP_OMIT_CMT=1 for the off arm — and nothing else
 * that could move either prompt off its pinned bytes (no MCP servers,
 * no goal id / workspace, no textedit root, no citation
 * instrumentation, the canonical default module selection).
 */
function armEnv(arm: Arm): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
    NEO4J_URI: config.neo4j.uri,
    NEO4J_USER: config.neo4j.user,
    NEO4J_PASSWORD: config.neo4j.password,
    PG_DSN: pgDsn(),
    TRELLIS_MODULES: JSON.stringify(['spatial-flywheel']),
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  delete env.TRELLIS_MCP_SERVERS;
  delete env.TRELLIS_EDIT_ROOT;
  delete env.TRELLIS_TEXTEDIT_MAX_FILE_BYTES;
  delete env.TRELLIS_TEXTEDIT_MAX_FILES;
  delete env.TRELLIS_CITATION_AUDIT;
  delete env.TRELLIS_CITATION_HINT;
  delete env.TRELLIS_CITATION_ENTAIL;
  delete env.TRELLIS_EXP_OMIT_CMT;
  if (arm === 'off') env.TRELLIS_EXP_OMIT_CMT = '1';
  return env;
}

function spawnRun(arm: Arm, question: string, maxIterations: number): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const script = path.resolve('src', 'rlm', 'trellis_agent.py');
    const child = spawn(
      config.python.executable,
      [script, '--query', question, '--max-iterations', String(maxIterations)],
      { env: armEnv(arm) }
    );
    let stdout = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (c: string) => { stdout += c; });
    child.stderr.on('data', () => { /* suppressed; raw stdout is logged */ });
    child.on('error', reject);
    child.on('close', () => resolve({ stdout }));
  });
}

async function runOne(
  arm: Arm,
  q: ProbeQuestion,
  maxIterations: number,
  logDir: string
): Promise<RunRow> {
  const { stdout } = await spawnRun(arm, q.question, maxIterations);
  fs.writeFileSync(path.join(logDir, `${arm}-${q.id}.log`), stdout);
  const result = safeJson(extractLine(stdout, 'TRELLIS_RESULT:'));
  const telemetry = safeJson(extractLine(stdout, 'TRELLIS_TELEMETRY:'));
  const inputTokens = (telemetry?.input_tokens as number) ?? 0;
  const outputTokens = (telemetry?.output_tokens as number) ?? 0;
  const answer = String(result?.answer ?? '');
  return {
    arm,
    questionId: q.id,
    kind: q.kind,
    status: (result?.status as string) ?? 'unknown',
    correct: result?.status === 'ok' && q.isCorrect(answer),
    inputTokens,
    outputTokens,
    iterations: extractIterations(stdout),
    subcalls: (telemetry?.subcall_count as number) ?? 0,
    toolCalls: (telemetry?.tool_calls as number) ?? 0,
    costUsd: (inputTokens / 1e6) * PRICE_PER_M_INPUT + (outputTokens / 1e6) * PRICE_PER_M_OUTPUT,
    answer: normalizeWhitespace(answer).slice(0, 120),
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function printAggregate(rows: RunRow[], arms: Arm[]): void {
  console.log('\n==== AGGREGATE (medians per arm) ====');
  console.log(
    'arm  runs  correct  med(inTok)  med(outTok)  med(iter)  med(subcalls)  med(dbCalls)  totalCost'
  );
  for (const arm of arms) {
    const rs = rows.filter(r => r.arm === arm);
    if (rs.length === 0) continue;
    const correct = rs.filter(r => r.correct).length;
    const cost = rs.reduce((s, r) => s + r.costUsd, 0);
    console.log(
      `${arm.padEnd(4)} ${String(rs.length).padStart(4)}  ${String(correct).padStart(4)}/${rs.length}  `
      + `${String(median(rs.map(r => r.inputTokens))).padStart(10)}  `
      + `${String(median(rs.map(r => r.outputTokens))).padStart(11)}  `
      + `${String(median(rs.map(r => r.iterations ?? 0))).padStart(9)}  `
      + `${String(median(rs.map(r => r.subcalls))).padStart(13)}  `
      + `${String(median(rs.map(r => r.toolCalls))).padStart(12)}  `
      + `$${cost.toFixed(4)}`
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.ingest) {
    await runIngest();
    return;
  }

  const corpus = fs.readFileSync(CORPUS_PATH, 'utf-8');
  const { rootHash, version } = await currentRoot();
  const storedRoot = await readRootNode(rootHash);
  const reconstruction = nodeText(storedRoot);
  assertRepresentationInvariant(corpus, reconstruction);
  const blocks = collectExtractionBlocks(storedRoot).filter(b => nodeText(b).trim().length > 0);
  const questions = buildQuestions(corpus, rootHash);

  const corpusTokens = Math.ceil(Buffer.byteLength(corpus, 'utf8') / 4);
  const runCount = args.arms.length * questions.length;
  console.log('Effective-context probe plan:');
  console.log(`  corpus:            ${DOC_KEY} version ${version} (root ${rootHash})`);
  console.log(`  blocks:            ${blocks.length} extraction-eligible; ≈${corpusTokens.toLocaleString()} corpus tokens`);
  console.log(`  arms:              ${args.arms.join(', ')} × ${questions.length} questions = ${runCount} runs`);
  console.log(`  max iterations:    ${args.maxIterations} per run`);
  console.log('  questions (expected answers computed from the committed file):');
  for (const q of questions) {
    console.log(`    ${q.id.padEnd(18)} [${q.kind}]  expected: ${q.expected.slice(0, 60)}${q.expected.length > 60 ? '…' : ''}`);
  }
  // Pre-flight estimate (stated assumptions, conservative): a run that
  // keeps the corpus in REPL state re-feeds only queries and bounded
  // prints (prior probes: low tens of thousands of input tokens); a run
  // that pulls the whole corpus through attention re-feeds ≈corpus
  // tokens on later iterations. The cumulative abort below is the hard
  // stop either way.
  const expectedPerRun = ((40_000 / 1e6) * PRICE_PER_M_INPUT) + ((2_000 / 1e6) * PRICE_PER_M_OUTPUT);
  const worstPerRun = ((corpusTokens * (args.maxIterations - 1)) / 1e6) * PRICE_PER_M_INPUT;
  console.log(
    `  estimate:          expected ≈$${expectedPerRun.toFixed(2)}/run (≤40k in / ≤2k out) `
    + `⇒ ≈$${(expectedPerRun * runCount).toFixed(2)} total; worst case ≈$${worstPerRun.toFixed(2)}/run `
    + `if the corpus re-feeds through attention every iteration`
  );
  console.log(`  hard stop:         cumulative spend > $${args.maxSpendUsd.toFixed(2)} aborts remaining runs`);

  if (!args.confirmPaid) {
    console.log(
      '\nPlan only — nothing spawned and nothing spent. Re-run with --confirm-paid to run the '
      + 'probe (owner-approved, per run).'
    );
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logDir = path.join('benchmark_logs', `effective-context-${stamp}`);
  fs.mkdirSync(logDir, { recursive: true });
  console.log(`\nRaw run logs: ${logDir}${path.sep}<arm>-<question>.log\n`);

  const rows: RunRow[] = [];
  let total = 0;
  let aborted = false;
  for (const arm of args.arms) {
    console.log(`--- arm: ${arm} (${arm === 'off' ? 'TRELLIS_EXP_OMIT_CMT=1 — pre-§6.2 kernel' : 'the pinned default kernel'}) ---`);
    for (const q of questions) {
      if (total > args.maxSpendUsd) { aborted = true; break; }
      const row = await runOne(arm, q, args.maxIterations, logDir);
      rows.push(row);
      total += row.costUsd;
      console.log(
        `  ${q.id.padEnd(18)} ${row.status.padEnd(9)} correct=${row.correct ? 'YES' : 'no '} `
        + `in=${String(row.inputTokens).padStart(7)} out=${String(row.outputTokens).padStart(6)} `
        + `iter=${row.iterations ?? '?'} sub=${row.subcalls} db=${row.toolCalls} `
        + `$${row.costUsd.toFixed(4)} | "${row.answer.slice(0, 70)}"`
      );
    }
    if (aborted) break;
  }
  if (aborted) {
    console.log(
      `\n*** ABORTED: cumulative spend $${total.toFixed(4)} crossed the $${args.maxSpendUsd.toFixed(2)} `
      + 'ceiling; remaining runs skipped. Partial results below. ***'
    );
  }

  fs.writeFileSync(
    path.join(logDir, 'summary.json'),
    JSON.stringify({ docKey: DOC_KEY, version, rootHash, maxIterations: args.maxIterations, aborted, rows }, null, 2)
  );
  printAggregate(rows, args.arms);
  console.log(`\nTotal spend: $${total.toFixed(4)} across ${rows.length} run(s).`);
}

main()
  .then(async () => { await pgPool.end().catch(() => {}); process.exit(0); })
  .catch(async error => {
    console.error(`\nFailed: ${error instanceof Error ? error.stack ?? error.message : error}`);
    await pgPool.end().catch(() => {});
    process.exit(1);
  });
