import crypto from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pgPool, neo4jDriver } from '../src/config/db';
import {
  createPgConvocationStore,
  replayConvocationRecords,
  type JudgeManifestPayload,
} from '../src/core/graph/judge_convocation_store';
import {
  buildRegistryFromState,
  describeMissingEvidentiaryHashes,
  fetchJudgeEntityStates,
  findMissingEvidentiaryHashes,
  judgeEntityName,
  mergeJudgeEntities,
  planJudgeRegistrations,
} from '../src/core/graph/judge_registration';

// Judge registration ceremony (JUDGE_CONVOCATION_DESIGN.md §3.1; the
// register_modules.ts mold).
//
//   npm run judges:register -- --file <manifests.json>       (register)
//   npm run judges:verify                        (read-only state report)
//   npm run judges:register -- --recover <judgeId> --reviewed-by <name>
//
// THE operator gate on judge capability: a human runs this command — no
// API endpoint registers judges, no model output triggers it, and it is
// never part of worker startup. The split representation: the full
// manifest (R-27 targetModelIdentity required) becomes a write-once
// store record; the shared graph gains ONLY the opaque contest hook
// (:Entity {kind: 'judge_manifest'}, name 'judge:<id>') citing the
// evidentiary hashes, so the EXISTING invalidation sweep contests a
// judge whose evidentiary bytes die — with zero sweep changes and
// nothing model-readable beyond an opaque id and hashes (AB-5).
//
// The existence gate runs before ANY write (the Session 14 discipline):
// every evidentiary hash must exist in ast_nodes or the whole
// invocation refuses with a bounded listing.
//
// Ceremony order: hooks merge FIRST (idempotent MERGE), store records
// append second — a partial failure leaves a hook without a manifest,
// which the consistency refusal names at run time and a ceremony re-run
// completes (the store append succeeds; the re-merge changes nothing).
//
// Recovery follows re-review (the module mold's rule): --recover
// re-merges a CONTESTED hook only, requires --reviewed-by (a named
// human), and refuses an uncontested judge — nothing to recover.
//
// Manifests file shape:
//   { "judges": [ { "manifest": { judgeId, role, rubricSha,
//     anchorSetSha, taxonomyVersion, targetModelIdentity },
//     "sourceNodeIds": ["<64-hex>", ...] }, ... ] }

interface CliArgs {
  file?: string;
  verify: boolean;
  recover?: string;
  reviewedBy?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { verify: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} requires a value`);
      return next;
    };
    switch (flag) {
      case '--file': args.file = resolve(value()); break;
      case '--verify': args.verify = true; break;
      case '--recover': args.recover = value(); break;
      case '--reviewed-by': args.reviewedBy = value(); break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

async function loadState() {
  const store = createPgConvocationStore(pgPool);
  const records = await store.loadAll();
  return { store, state: replayConvocationRecords(records) };
}

async function verifyMode(): Promise<number> {
  const { state } = await loadState();
  const graphStates = await fetchJudgeEntityStates(neo4jDriver);
  console.log(`Store manifests: ${state.manifests.size}; graph hooks: ${graphStates.length}`);
  try {
    buildRegistryFromState(state.manifests, graphStates);
    console.log('Consistency: every manifest has its hook and every hook its manifest.');
  } catch (err) {
    console.log(`CONSISTENCY REFUSAL: ${(err as Error).message}`);
  }
  for (const graph of graphStates) {
    console.log(`\n  ${graph.entityName}`);
    console.log(`    contested:   ${graph.contested}${graph.contested ? `  (since ${graph.contestedAt ? new Date(graph.contestedAt).toISOString() : '-'})` : ''}`);
    console.log(`    live evidentiary hashes:     ${graph.sourceNodeIds.length}`);
    console.log(`    orphaned evidentiary hashes: ${graph.orphanedSourceIds.length}`);
    if (graph.rederivedAt !== null) console.log(`    recovered:   ${new Date(graph.rederivedAt).toISOString()}`);
    if (graph.contested) {
      console.log(
        '    ACTION: the evidentiary basis of this judge changed. Re-review it, then recover with: '
        + `npm run judges:register -- --recover ${graph.entityName.replace(/^judge:/, '')} --reviewed-by <name>`
      );
    }
  }
  return 0;
}

async function recoverMode(args: CliArgs): Promise<number> {
  if (!args.reviewedBy) {
    console.error('Recovery refused: --reviewed-by <name> is required — recovery follows a named human re-review.');
    return 1;
  }
  const { state } = await loadState();
  const judgeId = args.recover as string;
  const payload = state.manifests.get(judgeId);
  if (!payload) {
    console.error(`Recovery refused: judge "${judgeId}" has no store manifest — nothing to recover.`);
    return 1;
  }
  const graphStates = await fetchJudgeEntityStates(neo4jDriver);
  const hook = graphStates.find((s) => s.entityName === judgeEntityName(judgeId));
  if (!hook) {
    console.error(`Recovery refused: judge "${judgeId}" has no graph hook — re-run the registration ceremony instead.`);
    return 1;
  }
  if (!hook.contested) {
    console.error(`Recovery refused: judge "${judgeId}" is not contested — nothing to recover.`);
    return 1;
  }
  await mergeJudgeEntities(
    neo4jDriver,
    [{ entityName: judgeEntityName(judgeId), sourceNodeIds: payload.sourceNodeIds }],
    () => crypto.randomUUID()
  );
  console.log(`Recovered ${judgeEntityName(judgeId)} (reviewed by ${args.reviewedBy}); the superseded contest history survives on the entity.`);
  return 0;
}

async function registerMode(args: CliArgs): Promise<number> {
  if (!args.file) {
    console.error('Registration refused: --file <manifests.json> is required.');
    return 1;
  }
  const input = JSON.parse(readFileSync(args.file, 'utf8')) as { judges: Array<{ manifest: unknown; sourceNodeIds: string[] }> };
  const { store, state } = await loadState();
  const planned = planJudgeRegistrations(input.judges, new Set(state.manifests.keys()));
  if (planned.length === 0) {
    console.log('Nothing to register.');
    return 0;
  }

  // The existence gate — before ANY write.
  const missing = await findMissingEvidentiaryHashes(pgPool, planned.flatMap((p) => p.sourceNodeIds));
  if (missing.length > 0) {
    console.error(`Registration refused: ${describeMissingEvidentiaryHashes(missing)}`);
    console.error('Evidentiary bytes must be verified substrate first (ingest the rubric/anchor fixtures). Nothing was registered.');
    return 1;
  }

  console.log('Registering judges (split representation):');
  for (const p of planned) {
    console.log(`  ${p.entityName}  (role ${p.manifest.role}, model ${p.manifest.targetModelIdentity}, ${p.sourceNodeIds.length} evidentiary hash(es))`);
  }
  await mergeJudgeEntities(neo4jDriver, planned, () => crypto.randomUUID());
  for (const p of planned) {
    const payload: JudgeManifestPayload = { manifest: p.manifest, sourceNodeIds: p.sourceNodeIds };
    await store.append({ kind: 'judge_manifest', key: p.judgeId, payload });
  }
  console.log(`\nRegistered ${planned.length} judge(s). Inspect with: npm run judges:verify`);
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.verify) return verifyMode();
  if (args.recover) return recoverMode(args);
  return registerMode(args);
}

main()
  .then(async (code) => {
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(`\nJudge registration failed: ${error instanceof Error ? error.message : error}`);
    console.error('Nothing was registered.');
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(1);
  });
