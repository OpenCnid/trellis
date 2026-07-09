import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { pgPool } from '../src/config/db';
import { config } from '../src/config/index';
import { MODULE_NAME_PATTERN, loadModule, readModuleManifest } from '../src/config/modules';
import {
  pinnedSourceNodeIds,
  readPromotedCorpus,
  type PromotedCorpus,
} from '../src/core/authoring/corpus';
import { assertSeedWithinBudget, corpusToSnapshot } from '../src/core/authoring/seed';
import { composeAuthoringPrompt, validateAuthoringTopic } from '../src/core/authoring/template';
import { ANCHOR_COVERAGE_THRESHOLD, evaluateAnchorGate } from '../src/core/authoring/anchors';
import {
  assertAuthoredAddendum,
  buildAddendumText,
  buildManifest,
  buildResearchDoc,
} from '../src/core/authoring/assemble';
import {
  RlmDraftScanner,
  parseDraftPayload,
  type DraftEnvelope,
  type DraftEvent,
} from '../src/core/observability/rlm_draft';
import { WorkspaceSnapshotSchema, type WorkspaceSnapshot } from '../src/workers/workspace_scratch';

// Grounded-authoring driver (Session 19, design record
// docs/architecture/GROUNDED_AUTHORING.md §4/§5). The operator gate that
// assembles a module directory from the promoted corpus plus a draft. In
// the promote / modules:register house style: a human running a CLI, no
// API surface, no model output triggering it.
//
//   npm run modules:author -- --module-name <name> --topic "<sentence>" \
//        --doc-key <key> [--doc-key <key> ...]                      (plan)
//   npm run modules:author -- ... --draft <file>            (zero-paid assemble)
//   npm run modules:author -- ... --confirm-paid            (paid spawn + assemble)
//
// Two gates before any spawn (the repo:ingest / promote double-gate
// idiom): the default echoes the plan and REFUSES to spawn; a paid run
// needs the explicit --confirm-paid acknowledgement, and per-run owner
// approval stays policy. --draft replays a saved TRELLIS_DRAFT JSON (the
// stub-replay precedent — the zero-paid path every drill uses) and never
// spawns.
//
// The driver assembles a directory for ordinary human review. It NEVER
// registers, NEVER lands, and NEVER edits an existing module (Guardrail
// 4): research.sourceNodeIds is pinned by the harness from the corpus,
// not chosen by the model (§5); registration stays a separate human step
// (npm run modules:register).

// Module #1 measurement (roadmap §5, July 9, 2026), echoed as the cost
// estimate. Author mode drops the exploratory whole-DB search calls, so
// the real spend is expected at or below this.
const MODULE_1_INPUT_TOKENS = 160_270;
const MODULE_1_OUTPUT_TOKENS = 7_827;

// Author runs read the corpus, reason, and write one JSON draft; a small
// ceiling is plenty and bounds a runaway. Kernel constant, not env-tuned.
const AUTHOR_MAX_ITERATIONS = 6;

interface CliArgs {
  moduleName?: string;
  topic?: string;
  docKeys: string[];
  outDir: string;
  goalId?: string;
  confirmPaid: boolean;
  draftFile?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { docKeys: [], outDir: path.resolve('modules'), confirmPaid: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} requires a value`);
      return next;
    };
    switch (flag) {
      case '--module-name': args.moduleName = value(); break;
      case '--topic': args.topic = value(); break;
      case '--doc-key': args.docKeys.push(value()); break;
      case '--out-dir': args.outDir = path.resolve(value()); break;
      case '--goal-id': args.goalId = value(); break;
      case '--confirm-paid': args.confirmPaid = true; break;
      case '--draft': args.draftFile = value(); break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Spawns the author run and resolves the collected draft (or a typed failure). */
function spawnAuthorRun(
  template: string,
  seedPath: string,
  goalId?: string
): Promise<{ ok: true; draft: DraftEnvelope } | { ok: false; message: string }> {
  return new Promise(resolve => {
    const script = path.resolve('src/rlm/trellis_agent.py');
    const childArgs = [
      script,
      '--mode', 'author',
      '--query', template,
      '--seed-workspace', seedPath,
      '--max-iterations', String(AUTHOR_MAX_ITERATIONS),
    ];
    if (goalId) childArgs.push('--goal-id', goalId);

    // Author mode constructs no database/MCP tool, so no DB credentials
    // are forwarded — only the interpreter path and the workspace bounds.
    const child = spawn(config.python.executable, childArgs, {
      env: {
        ...process.env,
        ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
        TRELLIS_WORKSPACE_MAX_SEGMENTS: String(config.workspace.maxSegments),
        TRELLIS_WORKSPACE_MAX_BYTES: String(config.workspace.maxBytes),
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    let collected: DraftEvent | null = null;
    const scanner = new RlmDraftScanner(event => {
      // The last draft line wins, matching the result-scanner convention.
      collected = event;
    });
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      process.stdout.write(chunk);
      scanner.feed(chunk);
    });
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => process.stderr.write(chunk));

    child.on('error', err => {
      resolve({ ok: false, message: `failed to spawn '${config.python.executable}': ${err.message}` });
    });
    child.on('close', code => {
      scanner.flush();
      if (collected === null) {
        resolve({ ok: false, message: `author run exited ${code} without emitting a draft envelope` });
        return;
      }
      const event: DraftEvent = collected;
      if (event.kind === 'draft') {
        resolve({ ok: true, draft: event.draft });
      } else {
        resolve({ ok: false, message: `draft ${event.kind}: ${event.reason}` });
      }
    });
  });
}

function printPlan(
  args: CliArgs,
  corpus: PromotedCorpus,
  seed: WorkspaceSnapshot,
  template: string
): void {
  const totalBytes = Buffer.byteLength(JSON.stringify(seed), 'utf8');
  const pinned = pinnedSourceNodeIds(corpus);
  console.log('Grounded authoring plan:');
  console.log(`  module name:        ${args.moduleName}`);
  console.log(`  topic:              ${args.topic}`);
  console.log(`  output directory:   ${path.join(args.outDir, args.moduleName as string)}`);
  console.log('  corpus documents:');
  for (const doc of corpus.documents) {
    console.log(`    ${doc.docKey}  (version ${doc.version}, ${doc.blockHashes.length} block(s))`);
  }
  console.log(`  corpus blocks (deduped, pinned): ${pinned.length}`);
  console.log(`  seed snapshot bytes:             ${totalBytes}`);
  console.log(`  seed segments:                   ${Object.keys(seed.segments).length}`);
  console.log(`  authoring template sha256:       ${sha256(template)}`);
  console.log(`  anchor coverage threshold:       ${ANCHOR_COVERAGE_THRESHOLD}`);
  console.log(
    `  estimated paid spend:            ~${MODULE_1_INPUT_TOKENS.toLocaleString()} input / `
    + `~${MODULE_1_OUTPUT_TOKENS.toLocaleString()} output tokens`
  );
  console.log('    (module #1 measurement; author mode drops exploratory whole-DB search, so likely lower)');
}

async function assembleModule(
  args: CliArgs,
  corpus: PromotedCorpus,
  draft: DraftEnvelope,
  provenanceNote: string
): Promise<number> {
  const moduleName = args.moduleName as string;
  const topic = args.topic as string;

  // The derivation gate (v1, deterministic): does the draft show contact
  // with the corpus it claims to derive from? Below threshold refuses
  // assembly with NOTHING written.
  const gate = evaluateAnchorGate(corpus.blocks.map(b => b.text), draft.addendum);
  console.log(
    `\nAnchor derivation gate: covered ${gate.covered}/${gate.total} corpus anchors `
    + `(ratio ${gate.ratio.toFixed(2)}, threshold ${gate.threshold}).`
  );
  if (!gate.passed) {
    console.error(
      `Assembly refused: the draft covers ${gate.ratio.toFixed(2)} of the corpus anchors, `
      + `below the ${gate.threshold} threshold — it does not demonstrably derive from the `
      + 'seeded research. Nothing was written.'
    );
    if (gate.missing.length > 0) {
      console.error(`  uncovered anchors (bounded): ${gate.missing.map(a => a.value).join(', ')}`);
    }
    return 1;
  }

  // Brace/size rules the module loader enforces, checked before any write.
  assertAuthoredAddendum(draft.addendum);

  const pinned = pinnedSourceNodeIds(corpus);
  const manifest = buildManifest({ moduleName, purpose: draft.purpose, sourceNodeIds: pinned });
  const addendumText = buildAddendumText(draft);
  const researchDoc = buildResearchDoc({
    moduleName,
    topic,
    corpus,
    gapNotes: draft.gapNotes,
    provenanceNote,
  });

  const moduleDir = path.join(args.outDir, moduleName);
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(path.join(moduleDir, 'module.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(moduleDir, 'addendum.txt'), addendumText);
  fs.writeFileSync(path.join(moduleDir, 'RESEARCH.md'), researchDoc);

  // Belt-and-suspenders: the written directory must pass the loader the
  // way modules:register and the composer will read it.
  readModuleManifest(moduleName, args.outDir);
  loadModule(moduleName, args.outDir);

  console.log(`\nAssembled module '${moduleName}' at ${moduleDir}:`);
  console.log(`  module.json   (research.sourceNodeIds pinned to ${pinned.length} corpus block(s))`);
  console.log('  addendum.txt  (the drafted protocol; loader-validated brace-free and in-bounds)');
  console.log('  RESEARCH.md   (corpus, provenance, and declared gaps)');
  console.log('\nThis is a directory for human review. It is NOT registered and NOT landed.');
  console.log('Next steps (both human): review and merge the module, then run');
  console.log('  npm run modules:register -- --module ' + moduleName);
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.moduleName || !MODULE_NAME_PATTERN.test(args.moduleName)) {
    console.error(`--module-name is required and must match ${MODULE_NAME_PATTERN}.`);
    return 1;
  }
  if (args.topic === undefined) {
    console.error('--topic is required (the single bounded sentence the corpus derives a protocol for).');
    return 1;
  }
  const topicCheck = validateAuthoringTopic(args.topic);
  if (!topicCheck.ok) {
    console.error(`Invalid --topic: ${topicCheck.message}.`);
    return 1;
  }
  if (args.docKeys.length === 0) {
    console.error('At least one --doc-key is required (the promoted corpus to author from).');
    return 1;
  }
  const moduleDir = path.join(args.outDir, args.moduleName);
  if (fs.existsSync(moduleDir)) {
    console.error(
      `Refusing to author over existing directory ${moduleDir}: the driver never edits an `
      + 'existing module (Guardrail 4). Choose a new --module-name.'
    );
    return 1;
  }

  const corpus = await readPromotedCorpus(pgPool, args.docKeys);
  const template = composeAuthoringPrompt(args.topic, args.docKeys);
  const seed = corpusToSnapshot(corpus.blocks, {
    mintId: () => crypto.randomUUID(),
    fetchedAt: new Date().toISOString(),
    goalId: args.goalId,
  });
  // Re-validate the seed as a lineage snapshot (the promotion echo idiom)
  // and refuse an over-budget corpus before any spawn or write — the same
  // decision the Python seed makes at spawn, made here so --draft enforces
  // it too (Guardrail 6).
  WorkspaceSnapshotSchema.parse(seed);
  assertSeedWithinBudget(seed, config.workspace.maxSegments, config.workspace.maxBytes);

  printPlan(args, corpus, seed, template);

  // --- zero-paid replay: assemble from a saved draft, never spawn ---
  if (args.draftFile) {
    const raw = fs.readFileSync(args.draftFile, 'utf-8');
    const draft = parseDraftPayload(raw, `draft file '${args.draftFile}'`);
    return assembleModule(args, corpus, draft, `Assembled from the saved draft ${path.basename(args.draftFile)} (zero-paid replay).`);
  }

  // --- plan-only default: refuse to spawn without explicit confirmation ---
  if (!args.confirmPaid) {
    console.log(
      '\nPlan only — nothing spawned and nothing written. Re-run with --draft <file> to '
      + 'assemble from a saved draft, or --confirm-paid to spawn the paid authoring run '
      + '(owner-approved, per run).'
    );
    return 0;
  }

  // --- paid path: spawn the author run, collect the draft, assemble ---
  const seedPath = path.join(
    os.tmpdir(),
    `trellis-author-seed-${process.pid}-${Date.now()}.json`
  );
  fs.writeFileSync(seedPath, JSON.stringify(seed));
  try {
    console.log('\n--confirm-paid set: spawning the paid authoring run...\n');
    const outcome = await spawnAuthorRun(template, seedPath, args.goalId);
    if (!outcome.ok) {
      console.error(`\nAuthoring run failed: ${outcome.message}. Nothing was written.`);
      return 1;
    }
    return assembleModule(
      args,
      corpus,
      outcome.draft,
      `Drafted by a paid RLM authoring run (model gpt-5.4-2026-03-05) under the grounded-authoring mode.`
    );
  } finally {
    fs.rmSync(seedPath, { force: true });
  }
}

main()
  .then(async code => {
    await pgPool.end().catch(() => {});
    process.exit(code);
  })
  .catch(async error => {
    console.error(`\nAuthoring failed: ${error instanceof Error ? error.message : error}`);
    console.error('Nothing was written.');
    await pgPool.end().catch(() => {});
    process.exit(1);
  });
