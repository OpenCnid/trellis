import { describe, expect, it } from 'vitest';
import {
  EPISODE_CONTINUITY_POLICY_VERSION,
  EPISODE_POLICY_SCHEMA_VERSION,
  EpisodeContinuationInputSchema,
  decideEpisodeContinuity,
  type EpisodeContinuationInput,
} from '../src/episode_policy.js';
import { REPOSITORY } from './fixtures.js';

function bindings(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: EPISODE_POLICY_SCHEMA_VERSION,
    policyVersion: EPISODE_CONTINUITY_POLICY_VERSION,
    sessionId: 'session:fixture',
    featureId: 'EL-05',
    role: 'implementer',
    semanticPhase: 'implementation',
    definitionDigest: '1'.repeat(64),
    repositoryPrecondition: structuredClone(REPOSITORY),
    promptDigest: '2'.repeat(64),
    timeBudgetMs: 60_000,
    turnBudget: 4,
    contextBudgetTokens: 8_000,
    adapterVersion: 'trellis-codex-app-server-runner:v1',
    ...overrides,
  };
}

function continuityInput(overrides: {
  prior?: Record<string, unknown>;
  current?: Record<string, unknown>;
  observation?: Record<string, unknown>;
} = {}) {
  return {
    prior: bindings(overrides.prior),
    current: bindings(overrides.current),
    observation: {
      activity: 'ordinary',
      definitionStatus: 'current',
      repositoryStatus: 'matching',
      promptStatus: 'compatible',
      adapterStatus: 'compatible',
      approvalStatus: 'not_required',
      elapsedMs: 1_000,
      turnsUsed: 1,
      contextTokensUsed: 1_000,
      ...overrides.observation,
    },
  };
}

describe('pure episode continuity policy', () => {
  it('resumes only unchanged, current, under-budget bindings', () => {
    expect(decideEpisodeContinuity(continuityInput())).toEqual({
      schemaVersion: EPISODE_POLICY_SCHEMA_VERSION,
      policyVersion: EPISODE_CONTINUITY_POLICY_VERSION,
      decision: 'resume',
      reason: 'unchanged_current_bindings',
      freshThreadRequired: false,
    });
  });

  it.each([
    ['session change', { current: { sessionId: 'session:new' } }, 'session_changed'],
    ['feature change', { current: { featureId: 'EL-06' } }, 'feature_changed'],
    ['role change', { current: { role: 'planner' } }, 'role_changed'],
    ['semantic phase change', { current: { semanticPhase: 'verification' } }, 'semantic_phase_changed'],
    ['acceptance definition change', { current: { definitionDigest: '3'.repeat(64) } }, 'acceptance_definition_changed'],
    ['repository change', { current: { repositoryPrecondition: { ...REPOSITORY, headCommit: '4'.repeat(64) } } }, 'repository_precondition_changed'],
    ['prompt change', { current: { promptDigest: '5'.repeat(64) } }, 'prompt_digest_changed'],
    ['time budget change', { current: { timeBudgetMs: 30_000 } }, 'time_budget_changed'],
    ['turn budget change', { current: { turnBudget: 3 } }, 'turn_budget_changed'],
    ['context budget change', { current: { contextBudgetTokens: 4_000 } }, 'context_budget_changed'],
    ['adapter version change', { current: { adapterVersion: 'trellis-codex-app-server-runner:v2' } }, 'adapter_version_changed'],
    ['recovery analysis', { observation: { activity: 'recovery_analysis' } }, 'recovery_analysis'],
    ['checker work', { observation: { activity: 'checker_work' } }, 'checker_work'],
    ['stale definition', { observation: { definitionStatus: 'stale' } }, 'stale_definition'],
    ['repository divergence', { observation: { repositoryStatus: 'diverged' } }, 'repository_diverged'],
    ['incompatible prompt version', { observation: { promptStatus: 'incompatible' } }, 'incompatible_prompt_version'],
    ['incompatible adapter version', { observation: { adapterStatus: 'incompatible' } }, 'incompatible_adapter_version'],
    ['context budget boundary', { observation: { contextTokensUsed: 8_000 } }, 'context_budget_boundary'],
  ] as const)('requires a fresh episode and thread for %s', (_name, overrides, reason) => {
    expect(decideEpisodeContinuity(continuityInput(overrides))).toMatchObject({
      decision: 'fresh_episode',
      reason,
      freshThreadRequired: true,
    });
  });

  it.each([
    ['expired approval', { approvalStatus: 'expired' }, 'expired_approval'],
    ['exhausted time budget', { elapsedMs: 60_000 }, 'time_budget_exhausted'],
    ['exhausted turn budget', { turnsUsed: 4 }, 'turn_budget_exhausted'],
  ] as const)('returns a typed stop for %s without validating or consuming authority', (_name, observation, reason) => {
    expect(decideEpisodeContinuity(continuityInput({ observation }))).toMatchObject({
      decision: 'stop',
      reason,
      freshThreadRequired: false,
    });
  });

  it('keeps conversation, compaction, runner memory, and model summaries outside durable policy truth', () => {
    const input = continuityInput() as EpisodeContinuationInput & Record<string, unknown>;
    input.conversationHistory = [{ role: 'assistant', content: 'claimed acceptance' }];
    expect(EpisodeContinuationInputSchema.safeParse(input).success).toBe(false);
    expect(EpisodeContinuationInputSchema.safeParse({
      ...continuityInput(),
      runnerMemory: 'resume because the model remembers',
    }).success).toBe(false);
  });
});
