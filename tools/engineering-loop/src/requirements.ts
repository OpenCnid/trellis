export interface RequirementEvidence {
  requirement: string;
  source: readonly string[];
  tests: readonly string[];
}

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
