/**
 * Judge-convocation unit pins (Session 70, JUDGE_CONVOCATION_DESIGN.md
 * §6). The drill (`npm run test:judge-convocation`) carries the
 * fixture-driven sections; these pins hold the load-bearing shapes in
 * `npm test` so a regression fails fast without the drill.
 */

import { describe, expect, it } from 'vitest';
import { POSTGRES_SCHEMA_SQL } from '../../config/schema';
import { config } from '../../config/index';
import {
  appendThroughLaw,
  createMemoryConvocationStore,
  replayConvocationRecords,
  StoreDuplicateError,
  StoreReplayError,
  type ConvocationRecord,
} from './judge_convocation_store';
import {
  buildRegistryFromState,
  ConvocationConsistencyError,
  JudgeRegistrationError,
  judgeEntityName,
  JUDGE_ENTITY_MERGE_CYPHER,
  planJudgeRegistrations,
  type JudgeEntityState,
} from './judge_registration';
import {
  buildEngineVerdict,
  buildSpawnRequest,
  judgeResponseSchema,
  makeLiveJudge,
  ModelIdentityMismatchError,
} from './judge_spawn';
import {
  candidateHashOf,
  candidateIdentityOf,
  judgeIdentityOf,
  mulberry32,
  pairKeyOf,
} from './support_sweep';
import { composeJudgePrompt, renderPrompt } from './judge_intake_prompt';
import { LateRegistrationError } from './judge_prereg';
import type { JudgeManifest } from './judge_panel';

const MANIFEST: JudgeManifest = {
  judgeId: 'j1-grounding-v1',
  role: 'J1_GROUNDING',
  rubricSha: 'ab'.repeat(32),
  anchorSetSha: 'cd'.repeat(32),
  taxonomyVersion: 'v1',
  targetModelIdentity: 'gpt-5.4-2026-03-05',
};

const HOOK: JudgeEntityState = {
  entityName: 'judge:j1-grounding-v1',
  sourceNodeIds: ['e1'.repeat(32)],
  orphanedSourceIds: [],
  contested: false,
  contestedAt: null,
  rederivedAt: null,
};

describe('convocation store', () => {
  it('is write-once mechanically: the (kind, key) primary key exists and the memory twin refuses a second write', async () => {
    expect(POSTGRES_SCHEMA_SQL).toMatch(/CREATE TABLE IF NOT EXISTS judge_records[\s\S]*?PRIMARY KEY \(kind, key\)/);
    const store = createMemoryConvocationStore([{ kind: 'run_open', key: 'r1', payload: { runId: 'r1', openedAtMs: 1 } }]);
    await expect(store.append({ kind: 'run_open', key: 'r1', payload: { runId: 'r1', openedAtMs: 2 } }))
      .rejects.toBeInstanceOf(StoreDuplicateError);
  });

  it('replays through the slice-1 law and refuses an unknown kind, typed', () => {
    expect(() => replayConvocationRecords([{ kind: 'mystery', key: 'k', payload: {} } as unknown as ConvocationRecord]))
      .toThrow(StoreReplayError);
  });

  it('validate-then-append: a forecast after run-open refuses through the law and never reaches the table', async () => {
    const store = createMemoryConvocationStore();
    let prereg = replayConvocationRecords([]).prereg;
    prereg = await appendThroughLaw(store, prereg, { kind: 'run_open', key: 'r1', payload: { runId: 'r1', openedAtMs: 1 } });
    await expect(appendThroughLaw(store, prereg, {
      kind: 'pre_registration',
      key: 'p1',
      payload: { registrationId: 'p1', runId: 'r1', registeredAtMs: 0, expectations: [{ itemId: 'i', expectedVerdict: 'clean', rationale: 'r' }] },
    })).rejects.toBeInstanceOf(LateRegistrationError);
    expect((await store.loadAll()).filter((r) => r.kind === 'pre_registration')).toHaveLength(0);
  });
});

describe('judge registration', () => {
  it('refuses a judgeId outside the entity charset and an empty evidentiary basis', () => {
    expect(() => planJudgeRegistrations([{ manifest: { ...MANIFEST, judgeId: 'J1:Bad' }, sourceNodeIds: ['e1'.repeat(32)] }], new Set()))
      .toThrow(JudgeRegistrationError);
    expect(() => planJudgeRegistrations([{ manifest: MANIFEST, sourceNodeIds: [] }], new Set()))
      .toThrow(JudgeRegistrationError);
  });

  it('a manifest change is a new registration under a new id', () => {
    expect(() => planJudgeRegistrations([{ manifest: MANIFEST, sourceNodeIds: ['e1'.repeat(32)] }], new Set(['j1-grounding-v1'])))
      .toThrow(JudgeRegistrationError);
  });

  it('the graph hook is opaque: the merge cypher carries no manifest field and keeps the recovery transition', () => {
    expect(JUDGE_ENTITY_MERGE_CYPHER).not.toMatch(/role|targetModelIdentity|rubricSha|anchorSetSha|taxonomy/);
    expect(JUDGE_ENTITY_MERGE_CYPHER).toMatch(/e\.contested = false/);
    expect(JUDGE_ENTITY_MERGE_CYPHER).toMatch(/rederivedAt/);
    expect(judgeEntityName('j1-grounding-v1')).toBe('judge:j1-grounding-v1');
  });

  it('registry assembly refuses a manifest without its hook and a hook without its manifest, naming the judge', () => {
    const manifests = new Map([['j1-grounding-v1', { manifest: MANIFEST, sourceNodeIds: HOOK.sourceNodeIds }]]);
    expect(() => buildRegistryFromState(manifests, [])).toThrow(ConvocationConsistencyError);
    expect(() => buildRegistryFromState(new Map(), [HOOK])).toThrow(ConvocationConsistencyError);
    const registry = buildRegistryFromState(manifests, [HOOK]);
    expect(registry.get('j1-grounding-v1')?.contested).toBe(false);
  });

  it('a contested hook carries into the pure registry', () => {
    const manifests = new Map([['j1-grounding-v1', { manifest: MANIFEST, sourceNodeIds: HOOK.sourceNodeIds }]]);
    const registry = buildRegistryFromState(manifests, [{ ...HOOK, contested: true, contestedAt: 5 }]);
    expect(registry.get('j1-grounding-v1')?.contested).toBe(true);
  });
});

describe('pair identity and the seeded sampler', () => {
  it('identity spans candidate bytes + mode and the manifest identity triple', () => {
    const base = { claimMode: 'fact' as const, claims: [{ address: 'x', content: 'bytes' }] };
    expect(candidateHashOf(base)).toBe(candidateHashOf({ ...base }));
    expect(candidateHashOf(base)).not.toBe(candidateHashOf({ ...base, claimMode: 'belief' as const }));
    expect(candidateHashOf(base)).not.toBe(candidateHashOf({ ...base, claims: [{ address: 'x', content: 'other bytes' }] }));
    expect(judgeIdentityOf(MANIFEST)).not.toBe(judgeIdentityOf({ ...MANIFEST, rubricSha: 'ff'.repeat(32) }));
    const key = pairKeyOf(candidateIdentityOf('sel-1', candidateHashOf(base)), judgeIdentityOf(MANIFEST));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mulberry32 is deterministic per seed (the record-specified sampler)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });
});

describe('the spawn boundary', () => {
  const composed = composeJudgePrompt(
    'J1_GROUNDING',
    'j1-grounding-v1',
    { selectionId: 's', claimMode: 'fact', claimContent: ['the claim bytes'] },
    { citedBytes: ['the cited bytes'] }
  );

  it('the transport is exactly the rendered bytes, hash re-verified pre-send', () => {
    const request = buildSpawnRequest(composed);
    expect(request.content).toBe(renderPrompt(composed));
    expect(request.promptHash).toBe(composed.promptHash);
    expect(() => buildSpawnRequest({ ...composed, promptHash: 'f'.repeat(64) })).toThrow();
  });

  it('model identity is a refusal before any I/O (R-27)', () => {
    expect(() => makeLiveJudge(MANIFEST, 'some-other-model')).toThrow(ModelIdentityMismatchError);
    expect(() => makeLiveJudge(MANIFEST, MANIFEST.targetModelIdentity)).not.toThrow();
  });

  it('the model supplies only {verdict, drawback, abstainReason}; weight and time are engine-side', () => {
    expect(judgeResponseSchema.safeParse({ verdict: 'clean', drawback: null, weight: 9 }).success).toBe(false);
    expect(judgeResponseSchema.safeParse({ verdict: 'clean', drawback: null, atMs: 1 }).success).toBe(false);
    const verdict = buildEngineVerdict({
      judgeId: 'j1-grounding-v1', role: 'J1_GROUNDING', beliefId: 'b',
      response: { verdict: 'abstain', drawback: null, abstainReason: 'evidence' }, atMs: 42, weight: 1.5,
    });
    expect(verdict.weight).toBe(1.5);
    expect(verdict.atMs).toBe(42);
  });
});

describe('writer-blind (RECONCILIATION §5 row 9)', () => {
  it('the T15 read function never references the convocation store', () => {
    const fnBody = POSTGRES_SCHEMA_SQL.slice(POSTGRES_SCHEMA_SQL.indexOf('CREATE OR REPLACE FUNCTION search_ast_nodes'));
    expect(fnBody.length).toBeGreaterThan(0);
    expect(fnBody).not.toContain('judge_records');
  });

  it('the support config twins carry the entailment-mold defaults', () => {
    expect(config.support.sampleRate).toBe(0.1);
    expect(config.support.judgeBudgetPerSweep).toBe(25);
    expect(config.support.verdictWeight).toBe(1);
  });
});
