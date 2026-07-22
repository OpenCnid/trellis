import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { ASTNode } from '../src/core/ast/parser';
import { parseMarkdownToAST } from '../src/core/ast/parser';
import { collectExtractionBlocks, flattenAST } from '../src/core/ast/traverse';
import { diffVersions } from '../src/core/ast/diff';
import {
  findGloballyOrphanedAstNodeIds,
  recordDocumentNodes,
  registerDocumentVersion,
} from '../src/core/ast/registry';
import { persistAstNodes, verifyPersistedAstNodes } from '../src/core/ast/persist';
import { pgPool, neo4jDriver } from '../src/config/db';
import {
  buildScaleCorpus,
  documentMentionCounts,
  DEFAULT_SCALE_BLOCKS_PER_DOCUMENT,
  DEFAULT_SCALE_DOCUMENTS,
  DEFAULT_SCALE_SEED,
  type ScaleBlock,
  type ScaleDocument,
} from '../src/benchmarks/scale/generate_scale_corpus';
import {
  evaluateMigrationDecision,
  summarize,
  type DistributionSummary,
  type ScaleGateSample,
} from '../src/benchmarks/scale/statistics';
import {
  mergeExtractedGraph,
  type EnrichedAction,
} from '../src/core/graph/extraction_merge';
import { fetchEntitySnippets } from '../src/core/graph/alias_resolution';
import type { CandidatePair, AliasEntity } from '../src/core/graph/alias_candidates';
import type { Entity } from '../src/core/graph/schemas';
import { sweepOrphanedProvenance } from '../src/core/graph/invalidation';

const DEFAULT_RESULTS_PATH = path.resolve(
  'docs',
  'benchmarks',
  'artifacts',
  'scale_drill_results.json',
);
const API_PORT = 3215;
const API_KEY = 'trellis-scale-drill-key';
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const SWEEP_ORPHAN_SET_SIZES = [1, 50, 500];
const SWEEP_REPETITIONS = 3;
const RETRIEVAL_REPETITIONS = 4;
const CONTEXT_REPETITIONS = 4;
const MERGE_PROBE_REPETITIONS = 5;
const MODIFIED_DOCUMENTS = 12;
const MODIFIED_BLOCKS_PER_DOCUMENT = 2;
const ACTUAL_SWEEP_BATCH_SIZE = 10;
const FIXED_GATE_ORPHAN_SET_SIZE = 50;

interface CliOptions {
  documentCount: number;
  blocksPerDocument: number;
  seed: number;
  resultsPath: string;
}

interface PreparedDocument {
  source: ScaleDocument;
  root: ASTNode;
  nodes: ASTNode[];
  extractionBlocks: ASTNode[];
}

interface MergeTiming {
  durationMs: number;
  containsHub: boolean;
}

interface CardinalityRows {
  nodes: Array<{ kind: string; cardinality: number }>;
  relationships: Array<{ kind: string; cardinality: number }>;
}

interface EntityState extends AliasEntity {
  contested: boolean;
  orphanedSourceIds: string[];
}

interface FactState {
  contested: boolean;
  sourceNodeIds: string[];
  orphanedSourceIds: string[];
}

interface ModificationExpectation {
  oldSurvivingHash: string;
  newSurvivingHash: string;
  survivingDetail: string;
  oldContestedHash: string;
  contestedDetail: string;
}

interface SweepMeasurement {
  orphanSetSize: number;
  repetitions: number;
  durationMs: DistributionSummary;
}

interface ScaleSampleResult {
  documentCount: number;
  semanticFacts: { nodes: number; relationships: number; total: number };
  sourceNodeIds: {
    nodes: Record<string, DistributionSummary>;
    relationships: Record<string, DistributionSummary>;
  };
  mergeLatencyMs: {
    allDocuments: DistributionSummary;
    documentsContainingHub: DistributionSummary;
  };
  sameGraphMergeProbeLatencyMs: {
    repetitions: number;
    hubSourceNodeIds: number;
    hub: DistributionSummary;
    singleSourceDetail: DistributionSummary;
  };
  hub: { name: string; documentsMentioning: number; sourceNodeIds: number };
  noHitSweepLatency: SweepMeasurement[];
}

interface ScaleDrillResults {
  schemaVersion: number;
  runDate: string;
  costPolicy: {
    llmCalls: number;
    paidCallsPermitted: boolean;
    pseudoExtraction: boolean;
  };
  environment: {
    node: string;
    platform: string;
    databases: Awaited<ReturnType<typeof databaseVersions>>;
  };
  config: Record<string, number | number[]>;
  mentionDistribution: Record<string, Array<{ name: string; count: number }>>;
  samples: ScaleSampleResult[];
  retrieval: {
    hub: Awaited<ReturnType<typeof measureRetrieval>>;
    tail: Awaited<ReturnType<typeof measureRetrieval>>;
  };
  aliasContextFetch: Record<string, {
    sourceNodeIds: number;
    latencyMs: DistributionSummary;
  }>;
  modificationSweep: {
    orphanCandidates: number;
    globallyOrphaned: number;
    freshHashes: number;
    result: Awaited<ReturnType<typeof sweepOrphanedProvenance>>;
    batchLatencyMs: DistributionSummary;
    correctness: Awaited<ReturnType<typeof verifyModificationOutcomes>>;
  };
  migrationDecision: ReturnType<typeof evaluateMigrationDecision>;
  cleanup?: Awaited<ReturnType<typeof cleanup>>;
}

function parsePositiveInteger(raw: string | undefined, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return value;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    documentCount: DEFAULT_SCALE_DOCUMENTS,
    blocksPerDocument: DEFAULT_SCALE_BLOCKS_PER_DOCUMENT,
    seed: DEFAULT_SCALE_SEED,
    resultsPath: DEFAULT_RESULTS_PATH,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--documents') {
      options.documentCount = parsePositiveInteger(value, flag);
      i++;
    } else if (flag === '--blocks') {
      options.blocksPerDocument = parsePositiveInteger(value, flag);
      i++;
    } else if (flag === '--seed') {
      options.seed = parsePositiveInteger(value, flag);
      i++;
    } else if (flag === '--results') {
      if (!value) throw new Error('--results requires a path');
      options.resultsPath = path.resolve(value);
      i++;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (options.documentCount < MODIFIED_DOCUMENTS) {
    throw new Error(`--documents must be at least ${MODIFIED_DOCUMENTS}`);
  }
  if (options.blocksPerDocument < MODIFIED_BLOCKS_PER_DOCUMENT) {
    throw new Error(`--blocks must be at least ${MODIFIED_BLOCKS_PER_DOCUMENT}`);
  }
  return options;
}

function globalId(name: string): string {
  return crypto.createHash('sha256').update(name.toLowerCase()).digest('hex');
}

function actionId(subject: string, verb: string, object: string): string {
  return crypto.createHash('sha256')
    .update(`${subject.toLowerCase()}\u0000${verb}\u0000${object.toLowerCase()}`)
    .digest('hex');
}

function prepareDocument(source: ScaleDocument): PreparedDocument {
  const root = parseMarkdownToAST(source.markdown);
  const extractionBlocks = collectExtractionBlocks(root);
  if (extractionBlocks.length !== source.blocks.length) {
    throw new Error(
      `${source.docKey}: expected ${source.blocks.length} extraction blocks, `
      + `parsed ${extractionBlocks.length}`
    );
  }
  return { source, root, nodes: flattenAST(root), extractionBlocks };
}

function pseudoExtraction(
  blocks: readonly ScaleBlock[],
  astBlocks: readonly ASTNode[]
): { entities: Entity[]; actions: EnrichedAction[] } {
  if (blocks.length !== astBlocks.length) {
    throw new Error('pseudo-extraction metadata and AST block counts differ');
  }
  const entities: Entity[] = [];
  const actions: EnrichedAction[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const sourceNodeIds = [astBlocks[i].id];
    entities.push(
      {
        id: globalId(block.subjectName),
        name: block.subjectName,
        type: 'ScaleHub',
        sourceNodeIds,
      },
      {
        id: globalId(block.detailName),
        name: block.detailName,
        type: 'ScaleDetail',
        sourceNodeIds,
      }
    );
    actions.push({
      id: actionId(block.subjectName, block.verb, block.detailName),
      verb: block.verb,
      subjectName: block.subjectName,
      objectName: block.detailName,
      subjectId: globalId(block.subjectName),
      objectId: globalId(block.detailName),
      sourceNodeIds,
    });
  }
  return { entities, actions };
}

async function persistVersion(document: PreparedDocument): Promise<void> {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await persistAstNodes(client, document.root.id, document.nodes);
    await verifyPersistedAstNodes(client, document.nodes);
    await recordDocumentNodes(client, document.root.id, document.nodes.map(node => node.id));
    await registerDocumentVersion(client, document.source.docKey, document.root.id);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function samplePoints(documentCount: number): number[] {
  const requested = documentCount < 50
    ? [Math.ceil(documentCount / 3), Math.ceil((documentCount * 2) / 3), documentCount]
    : [50, 150, documentCount];
  return [...new Set(requested.map(value => Math.min(value, documentCount)))]
    .filter(value => value > 0)
    .sort((a, b) => a - b);
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

async function readCardinalities(namespace: string): Promise<CardinalityRows> {
  const session = neo4jDriver.session();
  try {
    const nodes = await session.executeRead(tx => tx.run(
      `MATCH (n)
       WHERE n.name STARTS WITH $namespace AND n.sourceNodeIds IS NOT NULL
       RETURN labels(n) AS labels, size(n.sourceNodeIds) AS cardinality`,
      { namespace }
    ));
    const relationships = await session.executeRead(tx => tx.run(
      `MATCH (a)-[r]->(b)
       WHERE a.name STARTS WITH $namespace
         AND b.name STARTS WITH $namespace
         AND r.sourceNodeIds IS NOT NULL
       RETURN type(r) AS type, size(r.sourceNodeIds) AS cardinality`,
      { namespace }
    ));
    return {
      nodes: nodes.records.map(record => ({
        kind: (record.get('labels') as string[]).sort().join(':'),
        cardinality: asNumber(record.get('cardinality')),
      })),
      relationships: relationships.records.map(record => ({
        kind: String(record.get('type')),
        cardinality: asNumber(record.get('cardinality')),
      })),
    };
  } finally {
    await session.close();
  }
}

function summarizeByKind(
  rows: readonly { kind: string; cardinality: number }[]
): Record<string, DistributionSummary> {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const values = grouped.get(row.kind) ?? [];
    values.push(row.cardinality);
    grouped.set(row.kind, values);
  }
  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, values]) => [kind, summarize(values)])
  );
}

async function readEntity(name: string): Promise<EntityState> {
  const session = neo4jDriver.session();
  try {
    const result = await session.executeRead(tx => tx.run(
      `MATCH (e:Entity {name: toLower($name)})
       RETURN e.id AS id, e.name AS name, e.type AS type, e.kind AS kind,
              coalesce(e.sourceNodeIds, []) AS sourceNodeIds,
              coalesce(e.orphanedSourceIds, []) AS orphanedSourceIds,
              coalesce(e.contested, false) AS contested`,
      { name }
    ));
    const record = result.records[0];
    if (!record) throw new Error(`Entity not found: ${name}`);
    return {
      id: record.get('id'),
      name: record.get('name'),
      type: record.get('type') ?? undefined,
      kind: record.get('kind'),
      sourceNodeIds: record.get('sourceNodeIds'),
      orphanedSourceIds: record.get('orphanedSourceIds'),
      contested: record.get('contested'),
    };
  } finally {
    await session.close();
  }
}

async function readFact(subject: string, object: string): Promise<FactState> {
  const session = neo4jDriver.session();
  try {
    const result = await session.executeRead(tx => tx.run(
      `MATCH (:Entity {name: toLower($subject)})
             -[r:ACTION {verb: 'references'}]->
             (:Entity {name: toLower($object)})
       RETURN coalesce(r.contested, false) AS contested,
              coalesce(r.sourceNodeIds, []) AS sourceNodeIds,
              coalesce(r.orphanedSourceIds, []) AS orphanedSourceIds`,
      { subject, object }
    ));
    const record = result.records[0];
    if (!record) throw new Error(`ACTION not found: ${subject} -> ${object}`);
    return {
      contested: record.get('contested'),
      sourceNodeIds: record.get('sourceNodeIds'),
      orphanedSourceIds: record.get('orphanedSourceIds'),
    };
  } finally {
    await session.close();
  }
}

function fakeOrphans(namespace: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${namespace}-not-a-real-hash-${String(index).padStart(4, '0')}`
  );
}

async function measureNoHitSweeps(namespace: string): Promise<SweepMeasurement[]> {
  await sweepOrphanedProvenance(neo4jDriver, fakeOrphans(namespace, 1));
  const measurements = [];
  for (const orphanSetSize of SWEEP_ORPHAN_SET_SIZES) {
    const durations: number[] = [];
    for (let repetition = 0; repetition < SWEEP_REPETITIONS; repetition++) {
      const result = await sweepOrphanedProvenance(
        neo4jDriver,
        fakeOrphans(namespace, orphanSetSize)
      );
      if (
        result.contestedNodes !== 0
        || result.contestedRelationships !== 0
        || result.survivedNodes !== 0
        || result.survivedRelationships !== 0
      ) {
        throw new Error('a no-hit measurement sweep unexpectedly mutated graph state');
      }
      durations.push(result.durationMs);
    }
    measurements.push({
      orphanSetSize,
      repetitions: SWEEP_REPETITIONS,
      durationMs: summarize(durations),
    });
  }
  return measurements;
}

async function waitForServer(
  child: ChildProcess,
  log: () => string,
  timeoutMs = 30000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API exited early with code ${child.exitCode}: ${log().slice(-2000)}`);
    }
    try {
      const response = await fetch(`${API_BASE}/healthz`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`API did not start in time: ${log().slice(-2000)}`);
}

async function retrieve(name: string): Promise<{ graphRows: number; provenanceRows: number }> {
  const response = await fetch(
    `${API_BASE}/retrieve?entity=${encodeURIComponent(name)}&resolveAliases=false`,
    { headers: { 'x-api-key': API_KEY } }
  );
  if (!response.ok) throw new Error(`GET /retrieve returned ${response.status}`);
  const body = await response.json() as {
    graph: unknown[];
    provenance: unknown[];
    fallback_active: boolean;
  };
  if (body.fallback_active) throw new Error(`/retrieve used vector fallback for ${name}`);
  return { graphRows: body.graph.length, provenanceRows: body.provenance.length };
}

async function measureRetrieval(name: string): Promise<{
  latencyMs: DistributionSummary;
  graphRows: number;
  provenanceRows: number;
}> {
  await retrieve(name);
  const durations: number[] = [];
  let shape = { graphRows: 0, provenanceRows: 0 };
  for (let repetition = 0; repetition < RETRIEVAL_REPETITIONS; repetition++) {
    const startedAt = performance.now();
    shape = await retrieve(name);
    durations.push(performance.now() - startedAt);
  }
  return { latencyMs: summarize(durations), ...shape };
}

async function withApi<T>(work: () => Promise<T>): Promise<T> {
  let serverLog = '';
  const server = spawn(
    process.execPath,
    [path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs'), path.resolve('src', 'api', 'server.ts')],
    {
      env: {
        ...process.env,
        PORT: String(API_PORT),
        API_KEY,
        TRELLIS_SERVICE: 'scale-drill-api',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  server.stdout?.on('data', chunk => { serverLog += chunk.toString(); });
  server.stderr?.on('data', chunk => { serverLog += chunk.toString(); });
  try {
    await waitForServer(server, () => serverLog);
    return await work();
  } finally {
    server.kill();
  }
}

function contextPair(a: AliasEntity, b: AliasEntity): CandidatePair {
  const [first, second] = a.id < b.id ? [a, b] : [b, a];
  return {
    pairId: `${first.id}|${second.id}`,
    a: first,
    b: second,
    signal: 'edit_distance',
  };
}

async function measureContextFetch(
  entity: AliasEntity,
  comparison: AliasEntity
): Promise<DistributionSummary> {
  const pair = contextPair(entity, comparison);
  await fetchEntitySnippets(pgPool, [pair]);
  const durations: number[] = [];
  for (let repetition = 0; repetition < CONTEXT_REPETITIONS; repetition++) {
    const startedAt = performance.now();
    const snippets = await fetchEntitySnippets(pgPool, [pair]);
    durations.push(performance.now() - startedAt);
    if (!snippets.has(entity.id) || !snippets.has(comparison.id)) {
      throw new Error('alias context fetch did not resolve both provenance-bearing entities');
    }
  }
  return summarize(durations);
}

async function measureEntityMergeProbe(entity: AliasEntity): Promise<DistributionSummary> {
  const sourceNodeId = entity.sourceNodeIds[0];
  if (!sourceNodeId) throw new Error(`merge probe entity ${entity.name} has no provenance`);
  const input: Entity = {
    id: entity.id,
    name: entity.name,
    type: entity.type ?? 'ScaleProbe',
    sourceNodeIds: [sourceNodeId],
  };
  await mergeExtractedGraph(neo4jDriver, [input], []);
  const durations: number[] = [];
  for (let repetition = 0; repetition < MERGE_PROBE_REPETITIONS; repetition++) {
    const startedAt = performance.now();
    await mergeExtractedGraph(neo4jDriver, [input], []);
    durations.push(performance.now() - startedAt);
  }
  return summarize(durations);
}

function modifiedDocument(original: ScaleDocument): ScaleDocument {
  const blocks = original.blocks.map(block => ({ ...block }));
  blocks[0].text = `${blocks[0].text} Revised bytes retain the same semantic fact.`;
  blocks[1].detailName = `${blocks[1].detailName}-replacement`;
  blocks[1].text =
    `${blocks[1].subjectName} references ${blocks[1].detailName} after a semantic replacement.`;
  return { ...original, markdown: blocks.map(block => block.text).join('\n\n'), blocks };
}

function assertState(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`scale correctness assertion failed: ${message}`);
}

async function verifyModificationOutcomes(
  originalDocuments: readonly PreparedDocument[],
  expectations: readonly ModificationExpectation[]
): Promise<{ checkedFacts: number; contestedFacts: number; survivedFacts: number }> {
  let contestedFacts = 0;
  let survivedFacts = 0;
  for (let i = 0; i < expectations.length; i++) {
    const expectation = expectations[i];
    const original = originalDocuments[i].source;
    const survivingEntity = await readEntity(expectation.survivingDetail);
    const survivingAction = await readFact(original.blocks[0].subjectName, expectation.survivingDetail);
    for (const [kind, state] of [
      ['surviving entity', survivingEntity],
      ['surviving relationship', survivingAction],
    ] as const) {
      assertState(!state.contested, `${kind} ${i} was quarantined despite fresh re-derivation`);
      assertState(
        state.sourceNodeIds.includes(expectation.newSurvivingHash),
        `${kind} ${i} lacks its fresh source`
      );
      assertState(
        !state.sourceNodeIds.includes(expectation.oldSurvivingHash),
        `${kind} ${i} retained an orphaned source as live`
      );
      assertState(
        state.orphanedSourceIds.includes(expectation.oldSurvivingHash),
        `${kind} ${i} lost orphan audit history`
      );
      survivedFacts++;
    }

    const contestedEntity = await readEntity(expectation.contestedDetail);
    const contestedAction = await readFact(original.blocks[1].subjectName, expectation.contestedDetail);
    for (const [kind, state] of [
      ['contested entity', contestedEntity],
      ['contested relationship', contestedAction],
    ] as const) {
      assertState(state.contested, `${kind} ${i} stayed effective after its only source died`);
      assertState(
        !state.sourceNodeIds.includes(expectation.oldContestedHash),
        `${kind} ${i} retained an orphaned source as live`
      );
      assertState(
        state.orphanedSourceIds.includes(expectation.oldContestedHash),
        `${kind} ${i} lost orphan audit history`
      );
      contestedFacts++;
    }
  }
  return {
    checkedFacts: contestedFacts + survivedFacts,
    contestedFacts,
    survivedFacts,
  };
}

async function databaseVersions(): Promise<{ postgres: string; neo4j: string }> {
  const postgres = await pgPool.query('SELECT version() AS version');
  const session = neo4jDriver.session();
  try {
    const neo4j = await session.executeRead(tx => tx.run(
      'CALL dbms.components() YIELD name, versions RETURN name, versions LIMIT 1'
    ));
    return {
      postgres: String(postgres.rows[0].version),
      neo4j: `${neo4j.records[0].get('name')} ${(neo4j.records[0].get('versions') as string[])[0]}`,
    };
  } finally {
    await session.close();
  }
}

async function cleanup(
  namespace: string,
  rootHashes: readonly string[],
  newAstIds: readonly string[],
  preExistingNeoNames: ReadonlySet<string>
): Promise<{
  graphNodesRemoved: number;
  documentVersionsRemoved: number;
  documentMembershipsRemoved: number;
  astRowsRemoved: number;
  seededGraphNodesRemaining: number;
  seededDocumentsRemaining: number;
  seededAstRowsRemaining: number;
  preExistingAstRowsPreserved: number;
}> {
  let graphNodesRemoved = 0;
  const session = neo4jDriver.session();
  try {
    const graphResult = await session.executeWrite(tx => tx.run(
      `MATCH (n)
       WHERE n.name STARTS WITH $namespace AND NOT n.name IN $preserved
       WITH collect(n) AS doomed, count(n) AS removed
       FOREACH (n IN doomed | DETACH DELETE n)
       RETURN removed`,
      { namespace, preserved: [...preExistingNeoNames] }
    ));
    graphNodesRemoved = asNumber(graphResult.records[0].get('removed'));
  } finally {
    await session.close();
  }

  const client = await pgPool.connect();
  let documentVersionsRemoved = 0;
  let documentMembershipsRemoved = 0;
  let astRowsRemoved = 0;
  try {
    await client.query('BEGIN');
    documentVersionsRemoved = (
      await client.query('DELETE FROM documents WHERE doc_key LIKE $1', [`${namespace}%`])
    ).rowCount ?? 0;
    documentMembershipsRemoved = (
      await client.query(
        'DELETE FROM document_nodes WHERE root_hash = ANY($1::varchar[])',
        [rootHashes]
      )
    ).rowCount ?? 0;
    if (newAstIds.length > 0) {
      astRowsRemoved = (
        await client.query('DELETE FROM ast_nodes WHERE id = ANY($1::varchar[])', [newAstIds])
      ).rowCount ?? 0;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const verifySession = neo4jDriver.session();
  let seededGraphNodesRemaining = 0;
  try {
    const result = await verifySession.executeRead(tx => tx.run(
      `MATCH (n) WHERE n.name STARTS WITH $namespace
       AND NOT n.name IN $preserved RETURN count(n) AS count`,
      { namespace, preserved: [...preExistingNeoNames] }
    ));
    seededGraphNodesRemaining = asNumber(result.records[0].get('count'));
  } finally {
    await verifySession.close();
  }
  const remainingDocuments = await pgPool.query(
    'SELECT count(*)::int AS count FROM documents WHERE doc_key LIKE $1',
    [`${namespace}%`]
  );
  const remainingAst = newAstIds.length === 0
    ? { rows: [{ count: 0 }] }
    : await pgPool.query(
      'SELECT count(*)::int AS count FROM ast_nodes WHERE id = ANY($1::varchar[])',
      [newAstIds]
    );
  return {
    graphNodesRemoved,
    documentVersionsRemoved,
    documentMembershipsRemoved,
    astRowsRemoved,
    seededGraphNodesRemaining,
    seededDocumentsRemaining: Number(remainingDocuments.rows[0].count),
    seededAstRowsRemaining: Number(remainingAst.rows[0].count),
    preExistingAstRowsPreserved: 0,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const runToken = `${Date.now()}-${process.pid}`;
  const namespace = `trellis-scale-s7-${runToken}`;
  const corpus = buildScaleCorpus({
    seed: options.seed,
    documentCount: options.documentCount,
    blocksPerDocument: options.blocksPerDocument,
    namespace,
  });
  const mentions = documentMentionCounts(corpus);
  const mentionOrder = [...mentions.entries()].sort(
    ([aName, aCount], [bName, bCount]) => bCount - aCount || aName.localeCompare(bName)
  );
  const hubName = mentionOrder[0][0];
  const tailName = [...mentionOrder].reverse().find(([, count]) => count > 0)![0];
  const prepared = corpus.documents.map(prepareDocument);
  const modifiedSources = corpus.documents.slice(0, MODIFIED_DOCUMENTS).map(modifiedDocument);
  const preparedModified = modifiedSources.map(prepareDocument);
  const allCandidateNodes = new Map<string, ASTNode>();
  for (const document of [...prepared, ...preparedModified]) {
    for (const node of document.nodes) allCandidateNodes.set(node.id, node);
  }
  const allCandidateIds = [...allCandidateNodes.keys()];
  const rootHashes = [...new Set(
    [...prepared, ...preparedModified].map(document => document.root.id)
  )];

  const existingAst = await pgPool.query(
    'SELECT id FROM ast_nodes WHERE id = ANY($1::varchar[])',
    [allCandidateIds]
  );
  const preExistingAstIds = new Set<string>(existingAst.rows.map(row => row.id));
  const newAstIds = allCandidateIds.filter(id => !preExistingAstIds.has(id));
  const preSession = neo4jDriver.session();
  let preExistingNeoNames = new Set<string>();
  try {
    const result = await preSession.executeRead(tx => tx.run(
      'MATCH (n) WHERE n.name STARTS WITH $namespace RETURN n.name AS name',
      { namespace }
    ));
    preExistingNeoNames = new Set(result.records.map(record => String(record.get('name'))));
  } finally {
    await preSession.close();
  }

  const timings: MergeTiming[] = [];
  const samples: ScaleSampleResult[] = [];
  const points = new Set(samplePoints(options.documentCount));
  let priorSampleAt = 0;
  let results: ScaleDrillResults | undefined;
  let cleanupResult: Awaited<ReturnType<typeof cleanup>> | undefined;
  let runError: unknown;

  console.log(
    `Session 7 scale drill: ${options.documentCount} documents x `
    + `${options.blocksPerDocument} blocks, seed ${options.seed}`
  );
  console.log(
    `Hub ${hubName.replace(runToken, '<token>')} appears in ${mentions.get(hubName)} documents; `
    + `tail appears in ${mentions.get(tailName)}.`
  );

  try {
    for (let i = 0; i < prepared.length; i++) {
      const document = prepared[i];
      await persistVersion(document);
      const extraction = pseudoExtraction(document.source.blocks, document.extractionBlocks);
      const startedAt = performance.now();
      const merged = await mergeExtractedGraph(
        neo4jDriver,
        extraction.entities,
        extraction.actions
      );
      const durationMs = performance.now() - startedAt;
      assertState(
        merged.mergedActionIds.length === extraction.actions.length,
        `${document.source.docKey} merged ${merged.mergedActionIds.length}/`
        + `${extraction.actions.length} actions`
      );
      timings.push({
        durationMs,
        containsHub: document.source.blocks.some(block => block.subjectName === hubName),
      });

      const documentCount = i + 1;
      if (points.has(documentCount)) {
        const cardinalities = await readCardinalities(namespace);
        const nodeDistributions = summarizeByKind(cardinalities.nodes);
        const relationshipDistributions = summarizeByKind(cardinalities.relationships);
        const sweepMeasurements = await measureNoHitSweeps(namespace);
        const window = timings.slice(priorSampleAt, documentCount);
        const hub = await readEntity(hubName);
        const singleSourceDetail = await readEntity(prepared[0].source.blocks[0].detailName);
        samples.push({
          documentCount,
          semanticFacts: {
            nodes: cardinalities.nodes.length,
            relationships: cardinalities.relationships.length,
            total: cardinalities.nodes.length + cardinalities.relationships.length,
          },
          sourceNodeIds: {
            nodes: nodeDistributions,
            relationships: relationshipDistributions,
          },
          mergeLatencyMs: {
            allDocuments: summarize(window.map(timing => timing.durationMs)),
            documentsContainingHub: summarize(
              window.filter(timing => timing.containsHub).map(timing => timing.durationMs)
            ),
          },
          sameGraphMergeProbeLatencyMs: {
            repetitions: MERGE_PROBE_REPETITIONS,
            hubSourceNodeIds: hub.sourceNodeIds.length,
            hub: await measureEntityMergeProbe(hub),
            singleSourceDetail: await measureEntityMergeProbe(singleSourceDetail),
          },
          hub: {
            name: hub.name.replace(runToken, '<token>'),
            documentsMentioning: corpus.documents
              .slice(0, documentCount)
              .filter(document => document.blocks.some(block => block.subjectName === hubName))
              .length,
            sourceNodeIds: hub.sourceNodeIds.length,
          },
          noHitSweepLatency: sweepMeasurements,
        });
        priorSampleAt = documentCount;
        console.log(
          `  sampled ${documentCount}: ${cardinalities.nodes.length} nodes, `
          + `${cardinalities.relationships.length} relationships, `
          + `hub sources ${hub.sourceNodeIds.length}`
        );
      }
    }

    const hub = await readEntity(hubName);
    const tail = await readEntity(tailName);
    const hubDocument = prepared.find(
      document => document.source.blocks.some(block => block.subjectName === hubName)
    )!;
    const hubBlock = hubDocument.source.blocks.find(block => block.subjectName === hubName)!;
    const tailDocument = prepared.find(
      document => document.source.blocks.some(block => block.subjectName === tailName)
    )!;
    const tailBlock = tailDocument.source.blocks.find(block => block.subjectName === tailName)!;
    const hubDetail = await readEntity(hubBlock.detailName);
    const tailDetail = await readEntity(tailBlock.detailName);

    const retrieval = await withApi(async () => ({
      hub: await measureRetrieval(hubName),
      tail: await measureRetrieval(tailName),
    }));
    const aliasContextFetch = {
      hub: {
        sourceNodeIds: hub.sourceNodeIds.length,
        latencyMs: await measureContextFetch(hub, hubDetail),
      },
      tail: {
        sourceNodeIds: tail.sourceNodeIds.length,
        latencyMs: await measureContextFetch(tail, tailDetail),
      },
    };

    const orphanCandidates: string[] = [];
    const freshHashes: string[] = [];
    const expectations: ModificationExpectation[] = [];
    for (let i = 0; i < preparedModified.length; i++) {
      const original = prepared[i];
      const modified = preparedModified[i];
      await persistVersion(modified);
      const diff = await diffVersions(pgPool, original.root.id, modified.root.id);
      orphanCandidates.push(...diff.orphaned);
      const changed = [0, 1];
      const oldBlocks = changed.map(index => original.extractionBlocks[index].id);
      const newBlocks = changed.map(index => modified.extractionBlocks[index].id);
      assertState(
        oldBlocks.every((hash, index) => hash !== newBlocks[index]),
        `modified document ${i} did not change both target block hashes`
      );
      freshHashes.push(...newBlocks);
      const extraction = pseudoExtraction(
        changed.map(index => modified.source.blocks[index]),
        changed.map(index => modified.extractionBlocks[index])
      );
      await mergeExtractedGraph(neo4jDriver, extraction.entities, extraction.actions);
      expectations.push({
        oldSurvivingHash: oldBlocks[0],
        newSurvivingHash: newBlocks[0],
        survivingDetail: original.source.blocks[0].detailName,
        oldContestedHash: oldBlocks[1],
        contestedDetail: original.source.blocks[1].detailName,
      });
    }
    const globallyOrphaned = await findGloballyOrphanedAstNodeIds(
      pgPool,
      [...new Set(orphanCandidates)]
    );
    const actualSweep = await sweepOrphanedProvenance(
      neo4jDriver,
      globallyOrphaned,
      freshHashes,
      ACTUAL_SWEEP_BATCH_SIZE
    );
    const correctness = await verifyModificationOutcomes(prepared, expectations);
    assertState(correctness.contestedFacts === MODIFIED_DOCUMENTS * 2, 'contested fact count');
    assertState(correctness.survivedFacts === MODIFIED_DOCUMENTS * 2, 'survived fact count');
    assertState(
      actualSweep.contestedNodes >= MODIFIED_DOCUMENTS,
      'the scale sweep did not contest the expected single-source detail nodes'
    );
    assertState(
      actualSweep.contestedRelationships >= MODIFIED_DOCUMENTS,
      'the scale sweep did not contest the expected single-source ACTION edges'
    );
    assertState(
      actualSweep.survivedNodes >= MODIFIED_DOCUMENTS,
      'the scale sweep did not preserve freshly re-derived detail nodes'
    );
    assertState(
      actualSweep.survivedRelationships >= MODIFIED_DOCUMENTS,
      'the scale sweep did not preserve freshly re-derived ACTION edges'
    );

    const finalSample = samples[samples.length - 1];
    const allFinalDistributions = [
      ...Object.values(finalSample.sourceNodeIds.nodes),
      ...Object.values(finalSample.sourceNodeIds.relationships),
    ];
    const maxSourceNodeIds = Math.max(...allFinalDistributions.map(summary => summary.max));
    const gateSamples: ScaleGateSample[] = samples.map(sample => {
      const fixed = sample.noHitSweepLatency.find(
        measurement => measurement.orphanSetSize === FIXED_GATE_ORPHAN_SET_SIZE
      );
      if (!fixed) throw new Error('fixed-size sweep measurement is missing');
      return {
        documentCount: sample.documentCount,
        semanticFacts: sample.semanticFacts.total,
        fixedSweepMedianMs: fixed.durationMs.p50,
      };
    });
    const decision = evaluateMigrationDecision(gateSamples, maxSourceNodeIds);

    results = {
      schemaVersion: 1,
      runDate: '2026-07-06',
      costPolicy: {
        llmCalls: 0,
        paidCallsPermitted: false,
        pseudoExtraction: true,
      },
      environment: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        databases: await databaseVersions(),
      },
      config: {
        seed: options.seed,
        documents: options.documentCount,
        blocksPerDocument: options.blocksPerDocument,
        entityPoolSize: corpus.entityPool.length,
        citations: options.documentCount * options.blocksPerDocument,
        samplePoints: [...points],
        sweepOrphanSetSizes: SWEEP_ORPHAN_SET_SIZES,
        sweepRepetitions: SWEEP_REPETITIONS,
        mergeProbeRepetitions: MERGE_PROBE_REPETITIONS,
        modifiedDocuments: MODIFIED_DOCUMENTS,
        actualSweepBatchSize: ACTUAL_SWEEP_BATCH_SIZE,
      },
      mentionDistribution: {
        hubDocuments: mentionOrder.slice(0, 5).map(([name, count]) => ({
          name: name.replace(runToken, '<token>'),
          count,
        })),
        tailDocuments: mentionOrder.slice(-5).map(([name, count]) => ({
          name: name.replace(runToken, '<token>'),
          count,
        })),
      },
      samples,
      retrieval,
      aliasContextFetch,
      modificationSweep: {
        orphanCandidates: new Set(orphanCandidates).size,
        globallyOrphaned: globallyOrphaned.length,
        freshHashes: freshHashes.length,
        result: actualSweep,
        batchLatencyMs: summarize(actualSweep.batchDurationsMs),
        correctness,
      },
      migrationDecision: decision,
    };
  } catch (error) {
    runError = error;
  } finally {
    try {
      cleanupResult = await cleanup(
        namespace,
        rootHashes,
        newAstIds,
        preExistingNeoNames
      );
      cleanupResult.preExistingAstRowsPreserved = preExistingAstIds.size;
      assertState(cleanupResult.seededGraphNodesRemaining === 0, 'seeded graph nodes remain');
      assertState(cleanupResult.seededDocumentsRemaining === 0, 'seeded document versions remain');
      assertState(cleanupResult.seededAstRowsRemaining === 0, 'seeded AST rows remain');
      if (preExistingAstIds.size > 0) {
        const preserved = await pgPool.query(
          'SELECT count(*)::int AS count FROM ast_nodes WHERE id = ANY($1::varchar[])',
          [[...preExistingAstIds]]
        );
        assertState(
          Number(preserved.rows[0].count) === preExistingAstIds.size,
          'cleanup removed pre-existing AST rows'
        );
      }
    } catch (cleanupError) {
      if (!runError) runError = cleanupError;
      else console.error(`Cleanup also failed: ${String(cleanupError)}`);
    }
  }

  if (runError) throw runError;
  if (!results || !cleanupResult) throw new Error('scale drill completed without results');
  results.cleanup = cleanupResult;
  await fs.writeFile(options.resultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(
    `  actual sweep: ${results.modificationSweep.globallyOrphaned} orphan hashes, `
    + `${results.modificationSweep.result.batches} batches, `
    + `${results.modificationSweep.result.durationMs.toFixed(2)} ms`
  );
  console.log(
    `  correctness: ${results.modificationSweep.correctness.checkedFacts} facts checked; `
    + `${results.modificationSweep.correctness.contestedFacts} contested, `
    + `${results.modificationSweep.correctness.survivedFacts} survived`
  );
  console.log(
    `  migration gate: ${results.migrationDecision.justified ? 'OPEN' : 'CLOSED'} — `
    + results.migrationDecision.reasons.join('; ')
  );
  console.log(
    `  cleanup: ${cleanupResult!.graphNodesRemoved} graph nodes, `
    + `${cleanupResult!.astRowsRemoved} AST rows removed; zero seeded residue`
  );
  console.log(`Results written to ${options.resultsPath}`);
}

main()
  .then(async () => {
    await pgPool.end();
    await neo4jDriver.close();
  })
  .catch(async error => {
    console.error(error instanceof Error ? error.stack : String(error));
    try {
      await pgPool.end();
      await neo4jDriver.close();
    } catch {
      // Preserve the original failure.
    }
    process.exit(1);
  });
