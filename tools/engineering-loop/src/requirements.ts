export interface RequirementEvidence {
  requirement: string;
  source: readonly string[];
  tests: readonly string[];
}

/**
 * A producer of authorizing material a principal cannot author by hand
 * (`EL-REQ-APPROVAL-010`).
 *
 * A request digest is sha256 over the canonical form of a whole request. Nobody
 * computes that at a keyboard, so a protected action whose request digest has no
 * reachable producer is an authorization path a principal cannot walk — which is
 * indistinguishable from one that does not exist. EL-10 shipped exactly that and
 * it was found by inspection; nothing in the gate would have failed had nobody
 * looked. This table plus `resolveComputedMaterialProducers` is the check that
 * fails instead.
 *
 * `requestBuilder` is the symbol that composes the request the digest covers.
 * Reachability is derived from the import graph, never declared here: adding a row
 * to this table cannot make anything reachable.
 */
export interface ComputedMaterialProducer {
  /** The ceremony whose approval needs the material. */
  ceremony: string;
  /** The protected action the request carries. */
  action: string;
  /** The feature whose requirement owns the ceremony. */
  owningFeature: string;
  /** What a principal cannot author by hand. */
  material: string;
  /** The symbol that composes the request. */
  requestBuilder: string;
  /** The module that defines it, relative to `tools/engineering-loop/src`. */
  module: string;
}

export const COMPUTED_MATERIAL_PRODUCERS: readonly ComputedMaterialProducer[] = [
  {
    ceremony: 'seeding',
    action: 'acceptance_change',
    owningFeature: 'EL-10',
    material: 'seed request digest',
    requestBuilder: 'buildSeedRequest',
    module: 'seed.ts',
  },
  {
    ceremony: 'steady_state_acceptance',
    action: 'acceptance_change',
    owningFeature: 'EL-11',
    material: 'acceptance change request digest',
    requestBuilder: 'buildAcceptanceChangeRequest',
    module: 'acceptance_change.ts',
  },
  {
    ceremony: 'ledger_recovery',
    action: 'ledger_recovery',
    owningFeature: 'EL-10',
    material: 'content reconciliation request digest',
    requestBuilder: 'buildLedgerRecoveryRequest',
    module: 'ledger_recovery.ts',
  },
  {
    ceremony: 're_genesis',
    action: 'ledger_recovery',
    owningFeature: 'EL-10',
    material: 're-genesis request digest',
    requestBuilder: 'buildGenesisRequest',
    module: 'ledger_recovery.ts',
  },
] as const;

export const EL11_REQUIREMENT_EVIDENCE: readonly RequirementEvidence[] = [
  {
    requirement: 'EL-REQ-BOOT-008',
    source: ['acceptance_change.ts', 'acceptance_ledger.ts'],
    tests: [
      'acceptance_change: records an owner-approved status change against a non-empty generation',
      'acceptance_change: supersedes by replay and leaves the superseded records untouched',
      'acceptance_change: refusal matrix',
      'EL-11-A1: next_feature follows the ledger across a steady-state acceptance change',
    ],
  },
  {
    requirement: 'EL-REQ-APPROVAL-010',
    source: ['requirements.ts', 'activate.ts'],
    tests: ['requirements: every computed-material producer resolves a non-test caller'],
  },
  {
    requirement: 'EL-REQ-APPROVAL-012',
    source: ['acceptance_change.ts', 'activate.ts'],
    tests: ['requirements: the controller fully specifies a protected request before any approval exists'],
  },
] as const;

export const EL02_REQUIREMENT_EVIDENCE: readonly RequirementEvidence[] = [
  { requirement: 'EL-REQ-CORE-003', source: ['state_store.ts', 'writer_lock.ts'], tests: ['state_store: protected root'] },
  { requirement: 'EL-REQ-CORE-004', source: ['writer_lock.ts', 'state_store.ts'], tests: ['state_store: concurrent writers'] },
  { requirement: 'EL-REQ-CORE-006', source: ['state_machine.ts', 'kernel.ts'], tests: ['state_machine: feature selection'] },
  { requirement: 'EL-REQ-DATA-001', source: ['domain.ts'], tests: ['domain: nine strict versioned schemas'] },
  { requirement: 'EL-REQ-DATA-002', source: ['domain.ts'], tests: ['domain: persisted bindings'] },
  { requirement: 'EL-REQ-DATA-004', source: ['domain.ts', 'fakes.ts'], tests: ['domain: evidence origin and immutable bytes'] },
  { requirement: 'EL-REQ-STATE-001', source: ['domain.ts'], tests: ['domain: unknown states refuse'] },
  { requirement: 'EL-REQ-STATE-002', source: ['state_machine.ts'], tests: ['state_machine: exhaustive cross-product'] },
  { requirement: 'EL-REQ-STATE-003', source: ['domain.ts', 'state_machine.ts'], tests: ['state_machine: decision fields'] },
  { requirement: 'EL-REQ-STATE-004', source: ['state_machine.ts', 'kernel.ts'], tests: ['kernel: runner cannot mutate state'] },
  { requirement: 'EL-REQ-STATE-006', source: ['state_machine.ts'], tests: ['state_machine: ordinary progress path'] },
  { requirement: 'EL-REQ-STATE-008', source: ['state_machine.ts'], tests: ['state_machine: terminal immutability'] },
  { requirement: 'EL-REQ-STATE-009', source: ['state_store.ts', 'state_machine.ts'], tests: ['state_store: deterministic replay'] },
  { requirement: 'EL-REQ-STORE-001', source: ['state_store.ts'], tests: ['state_store: protected root'] },
  { requirement: 'EL-REQ-STORE-002', source: ['writer_lock.ts', 'state_store.ts'], tests: ['state_store: concurrent writers'] },
  { requirement: 'EL-REQ-STORE-003', source: ['events.ts', 'state_store.ts'], tests: ['state_store: integrity-linked journal'] },
  { requirement: 'EL-REQ-STORE-004', source: ['state_store.ts'], tests: ['state_store: event-first crash matrix'] },
  { requirement: 'EL-REQ-STORE-005', source: ['state_store.ts', 'domain.ts'], tests: ['state_store: atomic snapshot'] },
  { requirement: 'EL-REQ-STORE-006', source: ['state_store.ts', 'state_machine.ts'], tests: ['state_store: snapshot tail replay'] },
  { requirement: 'EL-REQ-STORE-007', source: ['state_store.ts', 'events.ts', 'state_machine.ts'], tests: ['state_store: corruption refusal'] },
  { requirement: 'EL-REQ-STORE-008', source: ['state_store.ts', 'kernel.ts', 'fakes.ts'], tests: ['kernel: durable-boundary crash matrix'] },
  { requirement: 'EL-REQ-RUNNER-004', source: ['fakes.ts', 'kernel.ts'], tests: ['kernel: zero-model fake dependencies'] },
  { requirement: 'EL-REQ-RECOVERY-004', source: ['domain.ts', 'kernel.ts'], tests: ['kernel: intent before invocation'] },
  { requirement: 'EL-REQ-RECOVERY-005', source: ['domain.ts', 'kernel.ts'], tests: ['kernel: typed outcome before transition'] },
  { requirement: 'EL-REQ-RECOVERY-006', source: ['kernel.ts', 'fakes.ts'], tests: ['kernel: stable idempotent retry'] },
  { requirement: 'EL-REQ-RECOVERY-008', source: ['kernel.ts', 'state_store.ts'], tests: ['kernel: reconstruct observe reconcile'] },
  { requirement: 'EL-REQ-SEC-001', source: ['state_store.ts', 'writer_lock.ts', 'fakes.ts'], tests: ['state_store: worktree isolation'] },
  { requirement: 'EL-REQ-SEC-007', source: ['domain.ts'], tests: ['domain: explicit bounds'] },
] as const;

export const EL03_REQUIREMENT_EVIDENCE: readonly RequirementEvidence[] = [
  { requirement: 'EL-REQ-DATA-006', source: ['domain.ts', 'handoff_renderer.ts'], tests: ['handoff_renderer: trusted report fields and counts'] },
  { requirement: 'EL-REQ-REPO-001', source: ['repo_observer.ts', 'command_evidence.ts'], tests: ['repo_observer: engine-computed repository identity'] },
  { requirement: 'EL-REQ-REPO-002', source: ['repo_observer.ts', 'path_scope.ts'], tests: ['repo_observer: complete NUL-delimited changed paths'] },
  { requirement: 'EL-REQ-REPO-003', source: ['repo_observer.ts', 'path_scope.ts'], tests: ['repo_observer: divergence refusal matrix'] },
  { requirement: 'EL-REQ-REPO-004', source: ['command_evidence.ts'], tests: ['command_evidence: exact bounded command observation'] },
  { requirement: 'EL-REQ-REPO-005', source: ['handoff_renderer.ts', 'domain.ts'], tests: ['handoff_renderer: evidence precedence'] },
  { requirement: 'EL-REQ-REPO-006', source: ['state_store.ts', 'command_evidence.ts'], tests: ['command_evidence: protected artifact placement'] },
  { requirement: 'EL-REQ-OBS-005', source: ['command_evidence.ts', 'events.ts', 'state_machine.ts'], tests: ['command_evidence: digest-linked retained artifacts'] },
  { requirement: 'EL-REQ-VIEW-001', source: ['handoff_renderer.ts'], tests: ['handoff_renderer: byte-identical renderer pins'] },
  { requirement: 'EL-REQ-VIEW-002', source: ['handoff_renderer.ts'], tests: ['handoff_renderer: pure read-only rendering'] },
  { requirement: 'EL-REQ-VIEW-003', source: ['handoff_renderer.ts'], tests: ['handoff_renderer: manual handoff authority'] },
  { requirement: 'EL-REQ-VIEW-005', source: ['handoff_renderer.ts'], tests: ['handoff_renderer: bounded reference-only context'] },
] as const;

export const EL04_REQUIREMENT_EVIDENCE: readonly RequirementEvidence[] = [
  { requirement: 'EL-REQ-PROMPT-001', source: ['prompt_compiler.ts', 'prompt_contracts.ts'], tests: ['prompt_compiler: named prompt-change boundary'] },
  { requirement: 'EL-REQ-PROMPT-002', source: ['prompt_compiler.ts'], tests: ['prompt_compiler: protocol-authored invariant asset review'] },
  { requirement: 'EL-REQ-PROMPT-003', source: ['prompt_compiler.ts'], tests: ['prompt_compiler: invariant frame precedes typed task data'] },
  { requirement: 'EL-REQ-PROMPT-004', source: ['prompt_contracts.ts', 'prompt_compiler.ts'], tests: ['prompt_compiler: six separate progressively disclosed collections'] },
  { requirement: 'EL-REQ-PROMPT-005', source: ['prompt_contracts.ts', 'prompt_compiler.ts'], tests: ['prompt_compiler: normalization versions budgets digests and snapshot pins'] },
  { requirement: 'EL-REQ-PROMPT-006', source: ['prompt_contracts.ts'], tests: ['prompt_contracts: four strict advisory role outputs'] },
  { requirement: 'EL-REQ-PROMPT-007', source: ['prompt_contracts.ts', 'prompt_compiler.ts'], tests: ['prompt_compiler: contamination and deterministic overflow refusal'] },
] as const;

export const EL05_REQUIREMENT_EVIDENCE: readonly RequirementEvidence[] = [
  { requirement: 'EL-REQ-RUNNER-001', source: ['runners/runner.ts', 'fakes.ts', 'kernel.ts'], tests: ['runner: full lifecycle conformance'] },
  { requirement: 'EL-REQ-RUNNER-002', source: ['runners/codex_app_server_runner.ts'], tests: ['codex_app_server_runner: pinned negotiation and zero-turn smoke'] },
  { requirement: 'EL-REQ-RUNNER-003', source: ['runners/codex_app_server_runner.ts', 'runners/runner.ts'], tests: ['codex_app_server_runner: boundary-only canonical translation'] },
  { requirement: 'EL-REQ-RUNNER-005', source: ['runners/runner.ts', 'kernel.ts', 'state_machine.ts'], tests: ['runner: advisory report has no controller authority'] },
  { requirement: 'EL-REQ-RUNNER-006', source: ['runners/runner.ts', 'runners/codex_app_server_runner.ts'], tests: ['codex_app_server_runner: exhaustive stable correlations'] },
  { requirement: 'EL-REQ-RUNNER-007', source: ['runners/runner.ts', 'runners/codex_app_server_runner.ts'], tests: ['codex_app_server_runner: typed bounded terminal outcome matrix'] },
  { requirement: 'EL-REQ-RUNNER-008', source: ['runners/runner.ts', 'runners/codex_app_server_runner.ts'], tests: ['codex_app_server_runner: ordering bounds duplicate refusal and redaction'] },
  { requirement: 'EL-REQ-EPISODE-001', source: ['episode_policy.ts'], tests: ['episode_policy: complete immutable episode bindings'] },
  { requirement: 'EL-REQ-EPISODE-002', source: ['episode_policy.ts'], tests: ['episode_policy: unchanged current resume only'] },
  { requirement: 'EL-REQ-EPISODE-003', source: ['episode_policy.ts'], tests: ['episode_policy: named fresh episode and thread matrix'] },
  { requirement: 'EL-REQ-EPISODE-005', source: ['episode_policy.ts', 'runners/runner.ts'], tests: ['episode_policy: conversation and runner memory exclusion'] },
  { requirement: 'EL-REQ-EPISODE-006', source: ['episode_policy.ts', 'prompt_contracts.ts', 'prompt_compiler.ts'], tests: ['prompt_compiler: validated typed fresh packet and bounded references'] },
  { requirement: 'EL-REQ-EPISODE-007', source: ['episode_policy.ts', 'runners/codex_app_server_runner.ts'], tests: ['episode_policy: stale divergence expiry and incompatibility matrix'] },
  { requirement: 'EL-REQ-EPISODE-008', source: ['runners/runner.ts', 'runners/codex_app_server_runner.ts', 'fakes.ts'], tests: ['runner: exactly one terminal observation and bounded report'] },
  { requirement: 'EL-REQ-OBS-001', source: ['runners/runner.ts'], tests: ['runner: timestamp actor bindings type sequence and metadata'] },
] as const;

export const EL06_REQUIREMENT_EVIDENCE: readonly RequirementEvidence[] = [
  { requirement: 'EL-REQ-DATA-003', source: ['verifier.ts', 'policy.ts'], tests: ['verifier: immutable active acceptance definition'] },
  { requirement: 'EL-REQ-DATA-005', source: ['policy.ts'], tests: ['policy: exact versioned approval bindings'] },
  { requirement: 'EL-REQ-STATE-005', source: ['verifier.ts', 'checker.ts', 'state_machine.ts'], tests: ['verifier: advisory evidence precedence'] },
  { requirement: 'EL-REQ-STATE-007', source: ['policy.ts', 'state_machine.ts'], tests: ['policy: protected action pause and external approval'] },
  { requirement: 'EL-REQ-STATE-010', source: ['verifier.ts', 'state_machine.ts'], tests: ['verifier: review and acceptance gate matrix'] },
  { requirement: 'EL-REQ-EPISODE-004', source: ['checker.ts', 'episode_policy.ts'], tests: ['checker: fresh read-only start-only episode'] },
  { requirement: 'EL-REQ-VERIFY-001', source: ['verifier.ts'], tests: ['verifier: controller-launched command observations'] },
  { requirement: 'EL-REQ-VERIFY-002', source: ['verifier.ts'], tests: ['verifier: separate immutable command evidence'] },
  { requirement: 'EL-REQ-VERIFY-003', source: ['verifier.ts'], tests: ['verifier: advisory evidence precedence'] },
  { requirement: 'EL-REQ-VERIFY-004', source: ['verifier.ts'], tests: ['verifier: exact command result bindings'] },
  { requirement: 'EL-REQ-VERIFY-005', source: ['verifier.ts'], tests: ['verifier: review gate completeness'] },
  { requirement: 'EL-REQ-VERIFY-006', source: ['checker.ts'], tests: ['checker: advisory authority exclusions'] },
  { requirement: 'EL-REQ-VERIFY-007', source: ['verifier.ts'], tests: ['verifier: stopping evidence findings'] },
  { requirement: 'EL-REQ-APPROVAL-001', source: ['policy.ts'], tests: ['policy: exhaustive protected action taxonomy'] },
  { requirement: 'EL-REQ-APPROVAL-002', source: ['policy.ts'], tests: ['policy: external protected approval channel'] },
  { requirement: 'EL-REQ-APPROVAL-003', source: ['policy.ts'], tests: ['policy: exact approval matching matrix'] },
  { requirement: 'EL-REQ-APPROVAL-004', source: ['policy.ts'], tests: ['policy: widening inheritance contingency retry refusal'] },
  { requirement: 'EL-REQ-APPROVAL-005', source: ['policy.ts'], tests: ['policy: paid estimate cap limit and actuals'] },
  { requirement: 'EL-REQ-APPROVAL-006', source: ['policy.ts', 'kernel.ts', 'state_store.ts'], tests: ['policy: atomic consumption and crash boundaries'] },
  { requirement: 'EL-REQ-APPROVAL-007', source: ['policy.ts'], tests: ['policy: explicit protected self-change actions'] },
  { requirement: 'EL-REQ-APPROVAL-008', source: ['policy.ts'], tests: ['policy: secret redaction and reference-only approval'] },
  { requirement: 'EL-REQ-APPROVAL-009', source: ['policy.ts'], tests: ['policy: automatic push and merge impossible'] },
  { requirement: 'EL-REQ-RECOVERY-001', source: ['recovery.ts'], tests: ['recovery: exhaustive failure classification'] },
  { requirement: 'EL-REQ-RECOVERY-002', source: ['recovery.ts'], tests: ['recovery: no-effect or identical idempotent retry'] },
  { requirement: 'EL-REQ-RECOVERY-003', source: ['recovery.ts'], tests: ['recovery: finite bounds delay and exhaustion'] },
  { requirement: 'EL-REQ-RECOVERY-007', source: ['recovery.ts'], tests: ['recovery: unknown external outcome blocking'] },
  { requirement: 'EL-REQ-RECOVERY-009', source: ['recovery.ts'], tests: ['recovery: implementation retry budget accounting'] },
  { requirement: 'EL-REQ-RECOVERY-010', source: ['recovery.ts'], tests: ['recovery: append-only signed reconciliation'] },
  { requirement: 'EL-REQ-OBS-002', source: ['policy.ts'], tests: ['policy: bounded coarse metric labels'] },
  { requirement: 'EL-REQ-OBS-004', source: ['policy.ts', 'checker.ts'], tests: ['policy: pre-persistence and prompt-reuse redaction'] },
  { requirement: 'EL-REQ-OBS-006', source: ['policy.ts', 'verifier.ts'], tests: ['policy: retention declaration and tombstone'] },
  { requirement: 'EL-REQ-OBS-007', source: ['policy.ts', 'verifier.ts'], tests: ['policy: raw secret persistence refusal'] },
  { requirement: 'EL-REQ-SEC-002', source: ['checker.ts'], tests: ['checker: least-privilege capability manifest'] },
  { requirement: 'EL-REQ-SEC-003', source: ['checker.ts', 'prompt_contracts.ts'], tests: ['checker: strict untrusted output validation'] },
  { requirement: 'EL-REQ-SEC-004', source: ['checker.ts', 'policy.ts'], tests: ['checker: credential omission and protected indirection'] },
  { requirement: 'EL-REQ-SEC-005', source: ['policy.ts'], tests: ['policy: protected controller self-modification taxonomy'] },
] as const;

export const EL10_REQUIREMENT_EVIDENCE: readonly RequirementEvidence[] = [
  { requirement: 'EL-REQ-BOOT-001', source: ['activate.ts', 'state_store.ts'], tests: ['activate: explicit configuration resolution', 'activate: protected root refusal matrix'] },
  { requirement: 'EL-REQ-BOOT-002', source: ['seed.ts', 'approval_channel.ts', 'policy.ts'], tests: ['seed: single approval-gated acceptance_change', 'seed: controller cannot author its own approval'] },
  { requirement: 'EL-REQ-BOOT-003', source: ['seed.ts', 'acceptance_ledger.ts'], tests: ['seed: refusal matrix', 'seed: all-or-nothing append'] },
  { requirement: 'EL-REQ-BOOT-004', source: ['acceptance_ledger.ts', 'handoff_renderer.ts'], tests: ['acceptance_ledger: status resolves from the ledger', 'EL-10-A3: the catalog carries no mutable status and names the exact authority'] },
  { requirement: 'EL-REQ-BOOT-005', source: ['acceptance_ledger.ts'], tests: ['acceptance_ledger: integrity refusal matrix', 'acceptance_ledger: append-only monotonic chain'] },
  { requirement: 'EL-REQ-BOOT-006', source: ['ledger_recovery.ts', 'recovery.ts', 'activate.ts'], tests: ['ledger_recovery: content reconciliation ceremony', 'activate: recovery command pair composes and executes a content reconciliation end to end'] },
  { requirement: 'EL-REQ-BOOT-007', source: ['ledger_recovery.ts', 'acceptance_ledger.ts', 'activate.ts'], tests: ['ledger_recovery: re-genesis ceremony', 'ledger_recovery: disjoint ceremony predicates', 'activate: re-genesis command pair opens a new generation on a corrupt fixture ledger'] },
] as const;
