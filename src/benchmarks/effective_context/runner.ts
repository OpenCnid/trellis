import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ASTNode } from '../../core/ast/parser.js';
import { parseSourceFile } from '../../core/ast/source_parser.js';
import { collectExtractionBlocks, nodeText } from '../../core/ast/traverse.js';
import { ingestDocument, type IngestDeps, type IngestResult } from '../../core/ingestion/ingest_document.js';
import { loggerFor } from '../../core/observability/logger.js';
import { RlmResultScanner, type RlmResultEnvelope } from '../../core/observability/rlm_result.js';
import { config, pgDsn } from '../../config/index.js';
import { pgPool } from '../../config/db.js';
import { extractIterations, extractTelemetry, type Telemetry } from '../oolong/rlm_client.js';
import { PRICE_PER_M_INPUT, PRICE_PER_M_OUTPUT } from '../oolong/scoring.js';
import {
  FRANKENSTEIN_CORPUS_BYTES,
  FRANKENSTEIN_CORPUS_SHA256,
  FRANKENSTEIN_DOC_KEY,
  buildGroundTruth,
  estimateProbeRowSpend,
  estimateProbeSpend,
  median,
  scoreAnswer,
  sha256Utf8,
  type EffectiveContextArm,
  type GroundTruthQuestion,
} from './ground_truth.js';

const CORPUS_PATH = path.resolve('data/frankenstein.txt');
const REPOSITORY_ROOT = path.resolve('.');
const DEFAULT_MAX_SPEND_USD = 5;
const MAX_ITERATIONS = 5;
const RUN_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MODULE_SELECTION = JSON.stringify(['spatial-flywheel']);

function resolvedPythonExecutable(): string {
  const executable = config.python.executable;
  return path.isAbsolute(executable) || executable.includes('/') || executable.includes('\\')
    ? path.resolve(REPOSITORY_ROOT, executable)
    : executable;
}

function resolvedPythonPath(): string {
  const configured = config.python.pythonPath?.split(path.delimiter).filter(Boolean) ?? [];
  const resolved = configured.map(entry => path.isAbsolute(entry)
    ? entry
    : path.resolve(REPOSITORY_ROOT, entry));
  return [path.resolve(REPOSITORY_ROOT, 'src/rlm'), ...resolved].join(path.delimiter);
}

interface CliArgs {
  confirmPaid: boolean;
  ingestOnly: boolean;
  maxSpendUsd: number;
  outFile?: string;
}

interface ProbeCorpus {
  bytes: Buffer;
  text: string;
  root: ASTNode;
  blocks: ASTNode[];
}

export interface ProbeRow {
  sequence: number;
  questionId: string;
  kind: GroundTruthQuestion['spec']['kind'];
  arm: EffectiveContextArm;
  status: RlmResultEnvelope['status'] | 'missing_result' | 'process_error';
  correct: boolean;
  expected: string | number;
  answer: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  iterations: number | null;
  subcallCount: number | null;
  databaseToolCalls: number | null;
  blocksRead: number | null;
  vectorSearches: number | null;
  reportedCostUsd: number | null;
  costUsd: number | null;
  durationSeconds: number;
  exitCode: number | null;
  error: string | null;
  diagnostic: string | null;
  costSource: 'reported' | 'token-estimate' | null;
}

interface ArmSummary {
  arm: EffectiveContextArm;
  runs: number;
  correct: number;
  validTelemetry: number;
  medianInputTokens: number | null;
  medianOutputTokens: number | null;
  medianIterations: number | null;
  medianSubcalls: number | null;
  medianDatabaseToolCalls: number | null;
  totalSpendUsd: number;
}

interface ProbeArtifact {
  generatedAt: string;
  corpus: {
    docKey: string;
    bytes: number;
    sha256: string;
    rootHash: string;
    orderedBlocks: number;
  };
  model: string;
  maxIterations: number;
  estimate: ReturnType<typeof estimateProbeSpend>;
  maxSpendUsd: number;
  storedDocumentVersion: number;
  rows: ProbeRow[];
  armSummaries: ArmSummary[];
  completed: boolean;
  aborted: boolean;
  totalObservedSpendUsd: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    confirmPaid: false,
    ingestOnly: false,
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
      case '--confirm-paid': args.confirmPaid = true; break;
      case '--ingest-only': args.ingestOnly = true; break;
      case '--max-spend-usd': {
        const parsed = Number(value());
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error('--max-spend-usd must be a positive number');
        }
        args.maxSpendUsd = parsed;
        break;
      }
      case '--out': args.outFile = path.resolve(value()); break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  if (args.ingestOnly && (args.confirmPaid || args.outFile !== undefined)) {
    throw new Error('--ingest-only cannot be combined with --confirm-paid or --out');
  }
  if (args.confirmPaid && args.outFile === undefined) {
    throw new Error('--confirm-paid requires --out so paid measurements cannot be lost');
  }
  return args;
}

async function loadCorpus(): Promise<ProbeCorpus> {
  const bytes = fs.readFileSync(CORPUS_PATH);
  const text = bytes.toString('utf8');
  if (bytes.byteLength !== FRANKENSTEIN_CORPUS_BYTES || sha256Utf8(text) !== FRANKENSTEIN_CORPUS_SHA256) {
    throw new Error(
      `Frankenstein corpus fingerprint mismatch: expected ${FRANKENSTEIN_CORPUS_BYTES} bytes / `
      + `${FRANKENSTEIN_CORPUS_SHA256}. Refuse to measure a moving corpus.`
    );
  }
  const parsed = await parseSourceFile('data/frankenstein.txt', bytes, {
    pythonExecutable: config.python.executable,
  });
  if (!parsed.ok) throw new Error(`Frankenstein .txt parsing failed: ${parsed.reason}`);
  if (nodeText(parsed.root) !== text) throw new Error('Frankenstein AST does not cover the exact corpus bytes.');
  const blocks = collectExtractionBlocks(parsed.root);
  if (blocks.length === 0 || blocks.some(block => block.type !== 'opaque_text')) {
    throw new Error('Frankenstein must parse into non-empty ordered opaque_text blocks.');
  }
  return { bytes, text, root: parsed.root, blocks };
}

function ingestDeps(): IngestDeps {
  return {
    pgPool,
    queues: {
      extraction: {
        addBulk: async jobs => {
          throw new Error(`Frankenstein policy none attempted to queue ${jobs.length} extraction job(s).`);
        },
      },
      invalidation: {
        add: async () => {
          throw new Error('Frankenstein zero-paid ingest attempted to queue invalidation.');
        },
      },
    },
    log: loggerFor({ component: 'exp_effective_context' }),
  };
}

function pythonGetAstTexts(hashes: readonly string[]): Promise<Record<string, string>> {
  const code = [
    'import sys',
    'from trellis_tools import TrellisPostgres',
    'tool = TrellisPostgres()',
    'try:',
    '    print(tool.get_ast_texts(sys.argv[1:]))',
    'finally:',
    '    tool.close()',
  ].join('\n');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PG_DSN: pgDsn(),
    PYTHONPATH: resolvedPythonPath(),
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  // This is a zero-paid physical-layer sample. Even an accidentally
  // imported SDK must not have a credential available to make a call.
  delete env.OPENAI_API_KEY;
  return new Promise((resolve, reject) => {
    execFile(
      resolvedPythonExecutable(),
      ['-c', code, ...hashes],
      { cwd: REPOSITORY_ROOT, env, maxBuffer: 1024 * 1024, timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(
            `Python get_ast_texts sample failed (${error.message}); stderr bytes=${Buffer.byteLength(stderr, 'utf8')}`
          ));
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('sample output was not an object');
          }
          const texts = parsed as Record<string, unknown>;
          if (Object.values(texts).some(value => typeof value !== 'string')) {
            throw new Error('sample output contained non-string text');
          }
          resolve(texts as Record<string, string>);
        } catch (parseError) {
          reject(new Error(
            `Python get_ast_texts sample returned malformed JSON: `
            + `${parseError instanceof Error ? parseError.message : String(parseError)}`
          ));
        }
      }
    );
  });
}

async function assertStoredCorpus(corpus: ProbeCorpus): Promise<{
  version: number;
  sampleHashes: string[];
  unembeddedBlocks: number;
  embeddedBlocks: number;
  pythonSamples: number;
}> {
  const latest = await pgPool.query(
    `SELECT version, root_hash FROM documents
     WHERE doc_key = $1 ORDER BY version DESC LIMIT 1`,
    [FRANKENSTEIN_DOC_KEY]
  );
  if (latest.rows.length !== 1) {
    throw new Error(`No registered ${FRANKENSTEIN_DOC_KEY}; run --ingest-only first.`);
  }
  const row = latest.rows[0] as { version: number; root_hash: string };
  if (row.root_hash !== corpus.root.id) {
    throw new Error(
      `Stored Frankenstein root ${row.root_hash} does not match committed corpus root ${corpus.root.id}.`
    );
  }

  const uniqueHashes = [...new Set(corpus.blocks.map(block => block.id))];
  const membership = await pgPool.query(
    `SELECT count(*)::int AS count FROM document_nodes
     WHERE root_hash = $1 AND node_id = ANY($2::varchar[])`,
    [corpus.root.id, uniqueHashes]
  );
  if (Number((membership.rows[0] as { count: number }).count) !== uniqueHashes.length) {
    throw new Error('Stored Frankenstein membership is missing one or more ordered block handles.');
  }

  const sampleIndexes = [0, Math.floor(corpus.blocks.length / 2), corpus.blocks.length - 1];
  const sampleBlocks = sampleIndexes.map(index => corpus.blocks[index]);
  const samples = await pgPool.query(
    'SELECT id, data FROM ast_nodes WHERE id = ANY($1::varchar[])',
    [sampleBlocks.map(block => block.id)]
  );
  const storedByHash = new Map(
    samples.rows.map((stored: { id: string; data: ASTNode }) => [stored.id, stored.data])
  );
  for (const block of sampleBlocks) {
    const stored = storedByHash.get(block.id);
    if (stored === undefined || nodeText(stored) !== nodeText(block)) {
      throw new Error(`Stored Frankenstein sample ${block.id} did not return its real text.`);
    }
  }
  const pythonTexts = await pythonGetAstTexts(sampleBlocks.map(block => block.id));
  for (const block of sampleBlocks) {
    if (pythonTexts[block.id] !== nodeText(block)) {
      throw new Error(`Python get_ast_texts sample ${block.id} did not return its real text.`);
    }
  }

  const embedding = await pgPool.query(
    `SELECT (count(*) FILTER (WHERE embedding IS NULL))::int AS unembedded,
            (count(*) FILTER (WHERE embedding IS NOT NULL))::int AS embedded
     FROM ast_nodes WHERE id = ANY($1::varchar[])`,
    [uniqueHashes]
  );
  const counts = embedding.rows[0] as { unembedded: number; embedded: number };
  if (Number(counts.embedded) + Number(counts.unembedded) !== uniqueHashes.length) {
    throw new Error('Stored Frankenstein embedding inventory did not cover every block handle.');
  }
  return {
    version: Number(row.version),
    sampleHashes: sampleBlocks.map(block => block.id),
    unembeddedBlocks: Number(counts.unembedded),
    embeddedBlocks: Number(counts.embedded),
    pythonSamples: Object.keys(pythonTexts).length,
  };
}

async function ingestCorpus(corpus: ProbeCorpus): Promise<{
  first: IngestResult | null;
  identicalReingest: IngestResult;
  stored: Awaited<ReturnType<typeof assertStoredCorpus>>;
}> {
  const request = {
    rootNode: corpus.root,
    docKey: FRANKENSTEIN_DOC_KEY,
    extractionPolicy: { mode: 'none' } as const,
    requestId: 'session21-frankenstein',
  };
  const prior = await pgPool.query(
    `SELECT version, root_hash FROM documents
     WHERE doc_key = $1 ORDER BY version DESC LIMIT 1`,
    [FRANKENSTEIN_DOC_KEY]
  );
  let first: IngestResult | null = null;
  if (prior.rows.length === 0) {
    first = await ingestDocument(ingestDeps(), request);
  } else {
    const priorRoot = String((prior.rows[0] as { root_hash: string }).root_hash);
    if (priorRoot !== corpus.root.id) {
      throw new Error(
        `Refusing to replace existing ${FRANKENSTEIN_DOC_KEY} root ${priorRoot} with `
        + `${corpus.root.id} through a drill that has no real invalidation queue.`
      );
    }
  }
  const identicalReingest = await ingestDocument(ingestDeps(), request);
  if (
    (first !== null && first.blocksQueued !== 0)
    || identicalReingest.blocksQueued !== 0
    || identicalReingest.diff === null
    || identicalReingest.diff.added !== 0
    || identicalReingest.diff.orphaned !== 0
  ) {
    throw new Error('Frankenstein identical re-ingest did not produce the expected zero-queue no-op diff.');
  }
  const stored = await assertStoredCorpus(corpus);
  return { first, identicalReingest, stored };
}

function questionInstruction(question: GroundTruthQuestion): string {
  switch (question.spec.kind) {
    case 'count':
      return (
        `Count the case-sensitive whole-word occurrences of ${JSON.stringify(question.spec.term)} `
        + 'in the complete corpus. Return only the decimal integer.'
      );
    case 'quote':
      return (
        `Return the complete sentence containing ${JSON.stringify(question.spec.needle)}. `
        + 'Preserve the exact corpus bytes inside that sentence, including its real line breaks. '
        + 'Return only the sentence.'
      );
    case 'section':
      return (
        `Find the one section whose body contains ${JSON.stringify(question.spec.needle)}. `
        + 'Return only its heading in the form Letter N or Chapter N.'
      );
  }
}

function buildQuery(question: GroundTruthQuestion): string {
  return (
    `Effective-context probe over verified document ${FRANKENSTEIN_DOC_KEY}. `
    + 'The current working directory contains handles.json with the ordered AST block hashes. '
    + 'Load that manifest, obtain corpus bytes only through trellis_postgres.get_ast_texts, '
    + 'and reconstruct document order from the manifest because the returned JSON map is unordered. '
    + 'Do not use vector_search, Neo4j, or any prior knowledge; this task is read-only. '
    + questionInstruction(question)
  );
}

function cleanProbeEnv(arm: EffectiveContextArm): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: resolvedPythonPath(),
    NEO4J_URI: config.neo4j.uri,
    NEO4J_USER: config.neo4j.user,
    NEO4J_PASSWORD: config.neo4j.password,
    PG_DSN: pgDsn(),
    TRELLIS_MODULES: DEFAULT_MODULE_SELECTION,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  for (const name of [
    'TRELLIS_EXP_OMIT_CMT',
    'TRELLIS_MCP_SERVERS',
    'TRELLIS_EDIT_ROOT',
    'TRELLIS_TEXTEDIT_MAX_FILE_BYTES',
    'TRELLIS_TEXTEDIT_MAX_FILES',
    'TRELLIS_WORKSPACE_MAX_SEGMENTS',
    'TRELLIS_WORKSPACE_MAX_BYTES',
    'TRELLIS_CITATION_HINT',
    'TRELLIS_CITATION_ENTAIL',
  ]) {
    delete env[name];
  }
  // Read-set observation is identical in both arms and does not alter the
  // prompt. It proves every answer actually loaded the full verified corpus
  // and that the no-vector-search experiment contract held.
  env.TRELLIS_CITATION_AUDIT = '1';
  if (arm === 'discipline-off') env.TRELLIS_EXP_OMIT_CMT = '1';
  return env;
}

function assertIsolatedArmEnvironments(): void {
  const on = cleanProbeEnv('discipline-on');
  const off = cleanProbeEnv('discipline-off');
  const intervention = off.TRELLIS_EXP_OMIT_CMT;
  delete off.TRELLIS_EXP_OMIT_CMT;
  if (intervention !== '1' || JSON.stringify(on) !== JSON.stringify(off)) {
    throw new Error('Probe arm environments differ by more than TRELLIS_EXP_OMIT_CMT=1.');
  }
}

interface ProcessOutput {
  stdout: string;
  stderrTail: string;
  exitCode: number | null;
  durationSeconds: number;
  processError: string | null;
}

interface CitationAudit {
  read: string[];
  search: string[];
}

function extractLastJsonLine<T>(stdout: string, prefix: string): T | null {
  const index = stdout.lastIndexOf(prefix);
  if (index === -1) return null;
  const line = stdout.slice(index + prefix.length).split('\n')[0].trim();
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

function measuredSpend(telemetry: Telemetry | null): {
  costUsd: number;
  reportedCostUsd: number | null;
  source: 'reported' | 'token-estimate';
} | null {
  if (telemetry === null) return null;
  const counts = [telemetry.input_tokens, telemetry.output_tokens];
  if (counts.some(value => !Number.isFinite(value) || value < 0)) return null;
  const reported = telemetry.reported_cost_usd;
  if (reported !== null && (!Number.isFinite(reported) || reported < 0)) return null;
  if (reported !== null && reported > 0) {
    return { costUsd: reported, reportedCostUsd: reported, source: 'reported' };
  }
  if (telemetry.input_tokens + telemetry.output_tokens <= 0) return null;
  return {
    costUsd:
      (telemetry.input_tokens / 1_000_000) * PRICE_PER_M_INPUT
      + (telemetry.output_tokens / 1_000_000) * PRICE_PER_M_OUTPUT,
    reportedCostUsd: null,
    source: 'token-estimate',
  };
}

function scrubDiagnostic(text: string, runCwd: string): string | null {
  if (text.trim().length === 0) return null;
  let scrubbed = text;
  for (const secret of [
    process.env.OPENAI_API_KEY,
    config.postgres.password,
    config.neo4j.password,
  ]) {
    if (secret) scrubbed = scrubbed.split(secret).join('[REDACTED]');
  }
  scrubbed = scrubbed
    .split(REPOSITORY_ROOT).join('<repository>')
    .split(runCwd).join('<run-cwd>');
  return scrubbed.slice(-2000);
}

function spawnProbeRun(
  arm: EffectiveContextArm,
  question: GroundTruthQuestion,
  cwd: string
): Promise<ProcessOutput> {
  return new Promise(resolve => {
    const started = Date.now();
    const script = path.resolve('src/rlm/trellis_agent.py');
    const child = spawn(
      resolvedPythonExecutable(),
      [script, '--query', buildQuery(question), '--max-iterations', String(MAX_ITERATIONS)],
      { cwd, env: cleanProbeEnv(arm) }
    );
    let stdout = '';
    let stderrTail = '';
    let captureBytes = 0;
    let settled = false;
    let processError: string | null = null;
    const timer = setTimeout(() => {
      processError = `timed out after ${RUN_TIMEOUT_MS} ms`;
      child.kill();
    }, RUN_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      captureBytes += Buffer.byteLength(chunk, 'utf8');
      if (captureBytes > MAX_CAPTURE_BYTES) {
        processError = `stdout exceeded ${MAX_CAPTURE_BYTES} bytes`;
        child.kill();
        return;
      }
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4096);
    });
    child.on('error', error => {
      processError = `failed to spawn ${resolvedPythonExecutable()}: ${error.message}`;
    });
    child.on('close', exitCode => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout,
        stderrTail,
        exitCode,
        durationSeconds: (Date.now() - started) / 1000,
        processError,
      });
    });
  });
}

async function runOne(
  sequence: number,
  arm: EffectiveContextArm,
  question: GroundTruthQuestion,
  cwd: string,
  expectedReadHashes: readonly string[]
): Promise<ProbeRow> {
  const output = await spawnProbeRun(arm, question, cwd);
  const holder: { result: RlmResultEnvelope | null } = { result: null };
  const scanner = new RlmResultScanner(event => {
    if (event.kind === 'result') holder.result = event.result;
  });
  scanner.feed(output.stdout);
  scanner.flush();
  const telemetry = extractTelemetry(output.stdout);
  const auditPayload = extractLastJsonLine<CitationAudit>(output.stdout, 'TRELLIS_CITATION_AUDIT:');
  const audit = auditPayload !== null
    && Array.isArray(auditPayload.read)
    && Array.isArray(auditPayload.search)
    ? auditPayload
    : null;
  const parsedResult: RlmResultEnvelope | null = holder.result;
  const answer = parsedResult?.answer ?? null;
  const iterations = extractIterations(output.stdout);
  const spend = measuredSpend(telemetry);
  const readHashes = new Set(Array.isArray(audit?.read) ? audit.read : []);
  const vectorSearches = Array.isArray(audit?.search) ? audit.search.length : null;
  const missingReads = expectedReadHashes.filter(hash => !readHashes.has(hash));
  const expectedReadSet = new Set(expectedReadHashes);
  const unexpectedReads = [...readHashes].filter(hash => !expectedReadSet.has(hash));
  const error = output.processError
    ?? (output.exitCode === 0 ? null : `agent process exited ${output.exitCode}`)
    ?? (telemetry === null ? 'missing or malformed TRELLIS_TELEMETRY' : null)
    ?? (spend === null ? 'telemetry carried no usable spend accounting' : null)
    ?? (parsedResult === null ? 'missing or malformed TRELLIS_RESULT' : null)
    ?? (parsedResult === null || parsedResult.status === 'ok'
      ? null
      : `agent result status ${parsedResult.status}`)
    ?? (telemetry !== null && telemetry.tool_calls > 0 ? null : 'zero database tool calls')
    ?? (audit === null ? 'missing or malformed TRELLIS_CITATION_AUDIT' : null)
    ?? (vectorSearches === 0 ? null : `vector_search called ${vectorSearches} time(s)`)
    ?? (missingReads.length === 0
      ? null
      : `get_ast_texts missed ${missingReads.length}/${expectedReadHashes.length} corpus block(s)`)
    ?? (unexpectedReads.length === 0
      ? null
      : `get_ast_texts read ${unexpectedReads.length} hash(es) outside the corpus manifest`)
    ?? (iterations === null ? 'missing REPL iteration summary' : null);
  return {
    sequence,
    questionId: question.spec.id,
    kind: question.spec.kind,
    arm,
    status: output.processError !== null
      ? 'process_error'
      : parsedResult?.status ?? 'missing_result',
    correct: error === null && scoreAnswer(question, answer),
    expected: question.expected,
    answer,
    inputTokens: telemetry?.input_tokens ?? null,
    outputTokens: telemetry?.output_tokens ?? null,
    iterations,
    subcallCount: telemetry?.subcall_count ?? null,
    databaseToolCalls: telemetry?.tool_calls ?? null,
    blocksRead: audit === null ? null : readHashes.size,
    vectorSearches,
    reportedCostUsd: spend?.reportedCostUsd ?? null,
    costUsd: spend?.costUsd ?? null,
    costSource: spend?.source ?? null,
    durationSeconds: output.durationSeconds,
    exitCode: output.exitCode,
    error: error === null ? null : `${error}; stderr captured=${Buffer.byteLength(output.stderrTail, 'utf8')} bytes`,
    diagnostic: error === null ? null : scrubDiagnostic(output.stderrTail, cwd),
  };
}

function schedule(truth: readonly GroundTruthQuestion[]): Array<{
  arm: EffectiveContextArm;
  question: GroundTruthQuestion;
}> {
  return truth.flatMap((question, index) => {
    const arms: EffectiveContextArm[] = index % 2 === 0
      ? ['discipline-on', 'discipline-off']
      : ['discipline-off', 'discipline-on'];
    return arms.map(arm => ({ arm, question }));
  });
}

function writeArtifact(outFile: string | undefined, artifact: ProbeArtifact): void {
  if (outFile === undefined) return;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

function availableMedian(
  rows: readonly ProbeRow[],
  pick: (row: ProbeRow) => number | null
): number | null {
  const values = rows.map(pick).filter((value): value is number => value !== null);
  return values.length === 0 ? null : median(values);
}

function summarizeRows(rows: readonly ProbeRow[]): ArmSummary[] {
  const summaries: ArmSummary[] = [];
  for (const arm of ['discipline-on', 'discipline-off'] as const) {
    const armRows = rows.filter(row => row.arm === arm);
    if (armRows.length === 0) continue;
    summaries.push({
      arm,
      runs: armRows.length,
      correct: armRows.filter(row => row.correct).length,
      validTelemetry: armRows.filter(row => row.costUsd !== null).length,
      medianInputTokens: availableMedian(armRows, row => row.inputTokens),
      medianOutputTokens: availableMedian(armRows, row => row.outputTokens),
      medianIterations: availableMedian(armRows, row => row.iterations),
      medianSubcalls: availableMedian(armRows, row => row.subcallCount),
      medianDatabaseToolCalls: availableMedian(armRows, row => row.databaseToolCalls),
      totalSpendUsd: armRows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
    });
  }
  return summaries;
}

function printSummary(summaries: readonly ArmSummary[]): void {
  console.log('\nEffective-context arm medians:');
  console.log('arm             correct  valid  input tokens  output tokens  iterations  subcalls  DB calls  spend');
  const fmt = (value: number | null, digits: number, width: number) =>
    (value === null ? 'n/a' : value.toFixed(digits)).padStart(width);
  for (const summary of summaries) {
    console.log(
      `${summary.arm.padEnd(16)} ${`${summary.correct}/${summary.runs}`.padStart(7)}  `
      + `${`${summary.validTelemetry}/${summary.runs}`.padStart(5)}  `
      + `${fmt(summary.medianInputTokens, 0, 12)}  `
      + `${fmt(summary.medianOutputTokens, 0, 13)}  `
      + `${fmt(summary.medianIterations, 1, 10)}  `
      + `${fmt(summary.medianSubcalls, 1, 8)}  `
      + `${fmt(summary.medianDatabaseToolCalls, 1, 8)}  `
      + `$${summary.totalSpendUsd.toFixed(4)}`
    );
  }
}

export async function runEffectiveContextCli(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const corpus = await loadCorpus();
  console.log(
    `Frankenstein corpus: ${corpus.bytes.byteLength} bytes, sha256 ${FRANKENSTEIN_CORPUS_SHA256}, `
    + `${corpus.blocks.length} ordered block(s), root ${corpus.root.id}.`
  );

  if (args.ingestOnly) {
    const result = await ingestCorpus(corpus);
    console.log(`FRANKENSTEIN_INGEST: ${JSON.stringify(result)}`);
    return 0;
  }

  const stored = await assertStoredCorpus(corpus);
  console.log(
    `Stored substrate verified: version ${stored.version}, ${stored.unembeddedBlocks} unembedded / `
    + `${stored.embeddedBlocks} pre-existing embedded `
    + `block(s), ${stored.pythonSamples} Python get_ast_texts sample(s).`
  );
  const truth = buildGroundTruth(corpus.text);
  const estimate = estimateProbeSpend(corpus.bytes.byteLength, truth.length);
  console.log('Effective-context paid-probe plan:');
  console.log(`  model:              gpt-5.4-2026-03-05`);
  console.log(`  questions / arms:   ${truth.length} fixed questions x 2 paired arms`);
  console.log(`  max iterations:     ${MAX_ITERATIONS} per subprocess`);
  console.log(`  estimated tokens:   ~${estimate.inputTokens.toLocaleString()} input / ~${estimate.outputTokens.toLocaleString()} output`);
  console.log(`  planning estimate:  ~$${estimate.costUsd.toFixed(2)} (ceiling $${args.maxSpendUsd.toFixed(2)})`);
  console.log('  runtime note:       post-run accounting gate, not a provider-side hard dollar limit');
  if (estimate.costUsd > args.maxSpendUsd) {
    console.error('Refusing before spawn: the fixed probe estimate exceeds the operator ceiling.');
    return 1;
  }
  if (!args.confirmPaid) {
    console.log('\nPlan only — no agent process spawned. Re-run with --confirm-paid after review.');
    return 0;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('Refusing before spawn: OPENAI_API_KEY is not set.');
    return 1;
  }

  assertIsolatedArmEnvironments();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-effective-context-'));
  const rows: ProbeRow[] = [];
  let totalSpend = 0;
  let aborted = false;
  const work = schedule(truth);
  const expectedReadHashes = [...new Set(corpus.blocks.map(block => block.id))];
  const artifact: ProbeArtifact = {
    generatedAt: new Date().toISOString(),
    corpus: {
      docKey: FRANKENSTEIN_DOC_KEY,
      bytes: corpus.bytes.byteLength,
      sha256: FRANKENSTEIN_CORPUS_SHA256,
      rootHash: corpus.root.id,
      orderedBlocks: corpus.blocks.length,
    },
    model: 'gpt-5.4-2026-03-05',
    maxIterations: MAX_ITERATIONS,
    estimate,
    maxSpendUsd: args.maxSpendUsd,
    storedDocumentVersion: stored.version,
    rows,
    armSummaries: [],
    completed: false,
    aborted: false,
    totalObservedSpendUsd: 0,
  };
  try {
    fs.writeFileSync(path.join(tempRoot, 'handles.json'), `${JSON.stringify({
      version: 1,
      docKey: FRANKENSTEIN_DOC_KEY,
      rootHash: corpus.root.id,
      blockHashes: corpus.blocks.map(block => block.id),
    }, null, 2)}\n`, 'utf8');

    console.log('\n--confirm-paid set: starting the counterbalanced paired run (no retries).');
    for (let index = 0; index < work.length; index++) {
      const remainingEstimate = work
        .slice(index)
        .reduce((sum, item) => sum + estimateProbeRowSpend(corpus.bytes.byteLength, item.arm).costUsd, 0);
      if (totalSpend + remainingEstimate > args.maxSpendUsd + 1e-9) {
        console.error(
          `Stopping before run ${index + 1}: observed $${totalSpend.toFixed(4)} + estimated `
          + `remaining $${remainingEstimate.toFixed(4)} exceeds $${args.maxSpendUsd.toFixed(2)}.`
        );
        aborted = true;
        break;
      }
      const item = work[index];
      const row = await runOne(
        index + 1,
        item.arm,
        item.question,
        tempRoot,
        expectedReadHashes
      );
      rows.push(row);
      if (row.costUsd === null) {
        console.error(`  run ${index + 1}: ${item.question.spec.id} / ${item.arm} has no spend telemetry; stopping.`);
        aborted = true;
        break;
      }
      totalSpend += row.costUsd;
      console.log(
        `  run ${index + 1}/${work.length}: ${item.question.spec.id} / ${item.arm} `
        + `status=${row.status} correct=${row.correct} input=${row.inputTokens} output=${row.outputTokens} `
        + `iterations=${row.iterations} subcalls=${row.subcallCount} db=${row.databaseToolCalls} `
        + `read=${row.blocksRead}/${expectedReadHashes.length} vector=${row.vectorSearches} `
        + `$${row.costUsd.toFixed(4)}`
      );
      if (totalSpend > args.maxSpendUsd) {
        console.error(`Standing ceiling exceeded after run ${index + 1}; no further process will spawn.`);
        aborted = true;
        break;
      }
    }
  } finally {
    artifact.generatedAt = new Date().toISOString();
    artifact.armSummaries = summarizeRows(rows);
    artifact.completed = !aborted && rows.length === work.length;
    artifact.aborted = aborted || rows.length !== work.length;
    artifact.totalObservedSpendUsd = totalSpend;
    writeArtifact(args.outFile, artifact);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  printSummary(artifact.armSummaries);
  console.log(`\nTotal observed spend: $${totalSpend.toFixed(4)} across ${rows.length}/${work.length} run(s).`);
  return aborted || rows.length !== work.length ? 1 : 0;
}
