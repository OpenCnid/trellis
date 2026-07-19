import crypto from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from '../src/config/index';
import { pgPool, neo4jDriver } from '../src/config/db';
import {
  createPgConvocationStore,
  replayConvocationRecords,
} from '../src/core/graph/judge_convocation_store';
import { fetchJudgeEntityStates } from '../src/core/graph/judge_registration';
import { makeLiveJudge, makeOracleJudge, type ConvocationJudge } from '../src/core/graph/judge_spawn';
import {
  mulberry32,
  runConvocationSweep,
  type EvidenceGather,
  type EvidenceGatherers,
} from '../src/core/graph/support_sweep';
import type { PromotionCandidate } from '../src/core/graph/judge_intake';

// The support_sweep runner (JUDGE_CONVOCATION_DESIGN.md §3.2/§3.3).
//
//   npm run support:sweep -- [--seed <n>] [--oracle <truth.json>]
//                            [--evidence <evidence.json>]
//                            [--live --confirm-paid [--model <id>]]
//
// Default mode is the ZERO-MODEL rehearsal: the oracle judge with an
// empty (or supplied) truth map — sampled pairs with no oracle answer
// are skipped and counted; nothing spawns. THE LIVE PATH IS
// TRIPLE-GATED (§3.3): --live AND --confirm-paid are the mechanical
// gates; the owner's dated paid-queue re-opening plus the per-run
// approval are the governance gates that must exist before an operator
// may pass them. Absent any gate, the live constructor is never
// reached.
//
// First-edition gatherers (record §3.2 implementation note): no
// citation or history channel exists in the intake chain yet, so J1
// and J2 report unavailable and the R-29 gate excludes them, typed and
// counted — the gates working, not a special case. J3's live gatherer
// needs an embedding call (paid), so the zero-model runner reports it
// unavailable unless --evidence supplies per-selection contexts
// (the rehearsal vehicle; shape below).
//
// Evidence file shape (per selectionId, each key optional):
//   { "<selectionId>": { "citedBytes": ..., "history": ...,
//                        "independentEvidence": ... }, ... }
// Oracle truth shape: { "<pairKey>": { "verdict": "clean" | "drawback"
//   | "abstain", "drawback": "<class>" | null, "abstainReason"?: ... } }

interface CliArgs {
  seed?: number;
  oracleFile?: string;
  evidenceFile?: string;
  live: boolean;
  confirmPaid: boolean;
  modelOverride?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { live: false, confirmPaid: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} requires a value`);
      return next;
    };
    switch (flag) {
      case '--seed': args.seed = Number(value()); break;
      case '--oracle': args.oracleFile = resolve(value()); break;
      case '--evidence': args.evidenceFile = resolve(value()); break;
      case '--live': args.live = true; break;
      case '--confirm-paid': args.confirmPaid = true; break;
      case '--model': args.modelOverride = value(); break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

function buildGatherers(evidenceFile?: string): EvidenceGatherers {
  const byEviSelection: Record<string, Record<string, unknown>> = evidenceFile
    ? JSON.parse(readFileSync(evidenceFile, 'utf8'))
    : {};
  const gather = (candidate: PromotionCandidate, key: string): EvidenceGather => {
    const supplied = byEviSelection[candidate.selectionId]?.[key];
    return supplied === undefined
      ? { available: false, context: {} }
      : { available: true, context: { [key]: supplied } };
  };
  return {
    async citedBytes(candidate) { return gather(candidate, 'citedBytes'); },
    async history(candidate) { return gather(candidate, 'history'); },
    async independentEvidence(candidate) { return gather(candidate, 'independentEvidence'); },
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const store = createPgConvocationStore(pgPool);
  const state = replayConvocationRecords(await store.loadAll());
  const graphStates = await fetchJudgeEntityStates(neo4jDriver);

  let judge: ConvocationJudge;
  if (args.live) {
    if (!args.confirmPaid) {
      console.error(
        'Live sweep refused: --live requires --confirm-paid (the mechanical half of the triple gate; the '
        + 'governance half — the owner\'s dated paid-queue re-opening plus the per-run approval — must exist first).'
      );
      return 1;
    }
    const perVerdictLow = 0.002;
    const perVerdictHigh = 0.01;
    console.log(
      `LIVE MODE: estimate class $${perVerdictLow.toFixed(3)}–$${perVerdictHigh.toFixed(2)} per verdict, `
      + `budget ${config.support.judgeBudgetPerSweep} verdicts (JUDGE_CONVOCATION_DESIGN.md §10; ≤$5/run cap binds).`
    );
    const manifests = state.manifests;
    judge = async (composed, pairKey) => {
      const payload = manifests.get(composed.judgeId);
      if (!payload) throw new Error(`Live spawn refused: no store manifest for judge "${composed.judgeId}".`);
      const configured = args.modelOverride ?? payload.manifest.targetModelIdentity;
      return makeLiveJudge(payload.manifest, configured)(composed, pairKey);
    };
  } else {
    const truth = args.oracleFile ? JSON.parse(readFileSync(args.oracleFile, 'utf8')) : {};
    judge = makeOracleJudge(truth);
  }

  const seed = args.seed ?? crypto.randomInt(0, 2 ** 31);
  console.log(`support_sweep: seed ${seed}, rate ${config.support.sampleRate}, budget ${config.support.judgeBudgetPerSweep}, mode ${args.live ? 'LIVE' : 'oracle'}`);

  const report = await runConvocationSweep({
    store,
    state,
    graphStates,
    gatherers: buildGatherers(args.evidenceFile),
    judge,
    policy: {
      sampleRate: config.support.sampleRate,
      judgeBudget: config.support.judgeBudgetPerSweep,
      random: mulberry32(seed),
    },
    runId: `sweep-${Date.now()}-${seed}`,
    nowMs: () => Date.now(),
    verdictWeight: config.support.verdictWeight,
  });

  console.log(JSON.stringify(report, null, 2));
  console.log('\nOpinions are computed at read time: npm run support:report');
  return 0;
}

main()
  .then(async (code) => {
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(`\nsupport_sweep failed: ${error instanceof Error ? error.message : error}`);
    console.error('Judge-all-then-write: no verdict records were appended.');
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(1);
  });
