import { z } from 'zod';
import {
  RepositoryObservationSchema,
  StableIdSchema,
  parseBoundary,
  sameRepositoryObservation,
} from './domain.js';
import { PromptRoleSchema } from './prompt_contracts.js';

export const EPISODE_POLICY_SCHEMA_VERSION = 1 as const;
export const EPISODE_CONTINUITY_POLICY_VERSION = 'trellis-episode-continuity:v1' as const;

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase sha256 digest');
const AdapterVersionSchema = z.string().min(1).max(128)
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'must be a bounded single-line version');

export const EpisodeBindingsSchema = z.strictObject({
  schemaVersion: z.literal(EPISODE_POLICY_SCHEMA_VERSION),
  policyVersion: z.literal(EPISODE_CONTINUITY_POLICY_VERSION),
  sessionId: StableIdSchema,
  featureId: StableIdSchema,
  role: PromptRoleSchema,
  semanticPhase: StableIdSchema,
  definitionDigest: DigestSchema,
  repositoryPrecondition: RepositoryObservationSchema,
  promptDigest: DigestSchema,
  timeBudgetMs: z.number().int().positive().max(86_400_000),
  turnBudget: z.number().int().positive().max(1_000),
  contextBudgetTokens: z.number().int().positive().max(10_000_000),
  adapterVersion: AdapterVersionSchema,
});

export type EpisodeBindings = z.infer<typeof EpisodeBindingsSchema>;

export const EpisodeContinuityObservationSchema = z.strictObject({
  activity: z.enum(['ordinary', 'recovery_analysis', 'checker_work']),
  definitionStatus: z.enum(['current', 'stale']),
  repositoryStatus: z.enum(['matching', 'diverged']),
  promptStatus: z.enum(['compatible', 'incompatible']),
  adapterStatus: z.enum(['compatible', 'incompatible']),
  approvalStatus: z.enum(['not_required', 'current', 'expired']),
  elapsedMs: z.number().int().nonnegative().max(86_400_000),
  turnsUsed: z.number().int().nonnegative().max(1_000),
  contextTokensUsed: z.number().int().nonnegative().max(10_000_000),
});

export type EpisodeContinuityObservation = z.infer<typeof EpisodeContinuityObservationSchema>;

export const EpisodeContinuationInputSchema = z.strictObject({
  prior: EpisodeBindingsSchema,
  current: EpisodeBindingsSchema,
  observation: EpisodeContinuityObservationSchema,
});

export type EpisodeContinuationInput = z.infer<typeof EpisodeContinuationInputSchema>;

export const EPISODE_DECISION_REASONS = [
  'unchanged_current_bindings',
  'session_changed',
  'feature_changed',
  'role_changed',
  'semantic_phase_changed',
  'acceptance_definition_changed',
  'repository_precondition_changed',
  'prompt_digest_changed',
  'time_budget_changed',
  'turn_budget_changed',
  'context_budget_changed',
  'adapter_version_changed',
  'recovery_analysis',
  'checker_work',
  'stale_definition',
  'repository_diverged',
  'incompatible_prompt_version',
  'incompatible_adapter_version',
  'context_budget_boundary',
  'time_budget_exhausted',
  'turn_budget_exhausted',
  'expired_approval',
] as const;

export const EpisodeDecisionReasonSchema = z.enum(EPISODE_DECISION_REASONS);
export type EpisodeDecisionReason = z.infer<typeof EpisodeDecisionReasonSchema>;

export const EpisodeContinuityDecisionSchema = z.strictObject({
  schemaVersion: z.literal(EPISODE_POLICY_SCHEMA_VERSION),
  policyVersion: z.literal(EPISODE_CONTINUITY_POLICY_VERSION),
  decision: z.enum(['resume', 'fresh_episode', 'stop']),
  reason: EpisodeDecisionReasonSchema,
  freshThreadRequired: z.boolean(),
}).superRefine((decision, ctx) => {
  if (decision.freshThreadRequired !== (decision.decision === 'fresh_episode')) {
    ctx.addIssue({ code: 'custom', path: ['freshThreadRequired'], message: 'must be true only for a fresh episode' });
  }
});

export type EpisodeContinuityDecision = z.infer<typeof EpisodeContinuityDecisionSchema>;

function decision(
  value: EpisodeContinuityDecision['decision'],
  reason: EpisodeDecisionReason
): EpisodeContinuityDecision {
  return parseBoundary(EpisodeContinuityDecisionSchema, {
    schemaVersion: EPISODE_POLICY_SCHEMA_VERSION,
    policyVersion: EPISODE_CONTINUITY_POLICY_VERSION,
    decision: value,
    reason,
    freshThreadRequired: value === 'fresh_episode',
  }, 'episode continuity decision');
}

export function decideEpisodeContinuity(inputValue: unknown): EpisodeContinuityDecision {
  const input = parseBoundary(EpisodeContinuationInputSchema, inputValue, 'episode continuity input');
  const { prior, current, observation } = input;

  if (observation.approvalStatus === 'expired') return decision('stop', 'expired_approval');
  if (observation.activity === 'recovery_analysis') return decision('fresh_episode', 'recovery_analysis');
  if (observation.activity === 'checker_work') return decision('fresh_episode', 'checker_work');

  if (prior.sessionId !== current.sessionId) return decision('fresh_episode', 'session_changed');
  if (prior.featureId !== current.featureId) return decision('fresh_episode', 'feature_changed');
  if (prior.role !== current.role) return decision('fresh_episode', 'role_changed');
  if (prior.semanticPhase !== current.semanticPhase) return decision('fresh_episode', 'semantic_phase_changed');
  if (prior.definitionDigest !== current.definitionDigest) {
    return decision('fresh_episode', 'acceptance_definition_changed');
  }
  if (!sameRepositoryObservation(prior.repositoryPrecondition, current.repositoryPrecondition)) {
    return decision('fresh_episode', 'repository_precondition_changed');
  }
  if (prior.promptDigest !== current.promptDigest) return decision('fresh_episode', 'prompt_digest_changed');
  if (prior.timeBudgetMs !== current.timeBudgetMs) return decision('fresh_episode', 'time_budget_changed');
  if (prior.turnBudget !== current.turnBudget) return decision('fresh_episode', 'turn_budget_changed');
  if (prior.contextBudgetTokens !== current.contextBudgetTokens) {
    return decision('fresh_episode', 'context_budget_changed');
  }
  if (prior.adapterVersion !== current.adapterVersion) return decision('fresh_episode', 'adapter_version_changed');

  if (observation.definitionStatus === 'stale') return decision('fresh_episode', 'stale_definition');
  if (observation.repositoryStatus === 'diverged') return decision('fresh_episode', 'repository_diverged');
  if (observation.promptStatus === 'incompatible') {
    return decision('fresh_episode', 'incompatible_prompt_version');
  }
  if (observation.adapterStatus === 'incompatible') {
    return decision('fresh_episode', 'incompatible_adapter_version');
  }
  if (observation.contextTokensUsed >= current.contextBudgetTokens) {
    return decision('fresh_episode', 'context_budget_boundary');
  }
  if (observation.elapsedMs >= current.timeBudgetMs) return decision('stop', 'time_budget_exhausted');
  if (observation.turnsUsed >= current.turnBudget) return decision('stop', 'turn_budget_exhausted');
  return decision('resume', 'unchanged_current_bindings');
}
