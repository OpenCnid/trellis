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
