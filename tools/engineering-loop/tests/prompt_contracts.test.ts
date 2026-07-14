import { describe, expect, it } from 'vitest';
import {
  MAX_ROLE_OUTPUT_BYTES,
  PROMPT_SCHEMA_VERSION,
  PromptContractError,
  ROLE_OUTPUT_CONTRACT_VERSIONS,
  parseRoleOutputJson,
  type PromptRole,
  type RoleOutputValidationContext,
} from '../src/prompt_contracts';

const REQUIREMENTS = Array.from({ length: 7 }, (_, index) => `EL-REQ-PROMPT-00${index + 1}`);

const CONTEXT: RoleOutputValidationContext = {
  requirementIds: REQUIREMENTS,
  evidenceIds: ['evidence:repository'],
  allowedPaths: ['tools/engineering-loop'],
  unresolvedEffectIds: ['operation:unknown'],
};

function validOutput(role: PromptRole): Record<string, unknown> {
  if (role === 'planner') {
    return {
      schemaVersion: PROMPT_SCHEMA_VERSION,
      contractVersion: ROLE_OUTPUT_CONTRACT_VERSIONS.planner,
      role,
      authority: 'advisory_only',
      summary: 'Bounded plan prepared.',
      requirementIds: REQUIREMENTS,
      allowedPathRequests: ['tools/engineering-loop'],
      steps: [{
        id: 'step:one',
        action: 'Implement the supplied requirement set.',
        requirementIds: REQUIREMENTS,
        allowedPathRequests: ['tools/engineering-loop'],
      }],
      risks: [{ id: 'risk:one', severity: 'low', summary: 'A bounded risk remains.' }],
      verificationRequests: [{ id: 'verify:one', summary: 'Run the focused deterministic suite.' }],
    };
  }
  if (role === 'implementer') {
    return {
      schemaVersion: PROMPT_SCHEMA_VERSION,
      contractVersion: ROLE_OUTPUT_CONTRACT_VERSIONS.implementer,
      role,
      authority: 'advisory_only',
      summary: 'Scoped implementation proposed.',
      proposedChangedPaths: ['tools/engineering-loop/src/prompt_contracts.ts'],
      requirementDispositions: REQUIREMENTS.map(requirementId => ({
        requirementId,
        status: 'implemented',
        summary: 'Implementation linkage is proposed.',
      })),
      verificationRequests: [{ id: 'verify:one', summary: 'Run deterministic verification.' }],
      findings: [{
        id: 'finding:one',
        severity: 'info',
        summary: 'Controller evidence remains authoritative.',
        evidenceReferences: ['evidence:repository'],
      }],
      blockers: [{ id: 'blocker:one', summary: 'No active blocker.', humanActionRequired: false }],
    };
  }
  if (role === 'checker') {
    return {
      schemaVersion: PROMPT_SCHEMA_VERSION,
      contractVersion: ROLE_OUTPUT_CONTRACT_VERSIONS.checker,
      role,
      authority: 'advisory_only',
      summary: 'Read-only assessment complete.',
      recommendation: 'ready_for_human_review',
      requirementAssessments: REQUIREMENTS.map(requirementId => ({
        requirementId,
        status: 'satisfied',
        summary: 'Supplied evidence supports the assessment.',
        evidenceReferences: ['evidence:repository'],
      })),
      findings: [{
        id: 'finding:one',
        severity: 'info',
        summary: 'Human review remains required.',
        evidenceReferences: ['evidence:repository'],
      }],
      evidenceReferences: ['evidence:repository'],
    };
  }
  return {
    schemaVersion: PROMPT_SCHEMA_VERSION,
    contractVersion: ROLE_OUTPUT_CONTRACT_VERSIONS.recovery,
    role,
    authority: 'advisory_only',
    summary: 'Unknown outcome requires reconciliation.',
    classification: 'unknown_side_effect',
    nextEvidenceRequests: [{ id: 'request:one', summary: 'Reconcile the protected target state.' }],
    safeActions: [{ id: 'action:one', summary: 'Pause for authoritative reconciliation.', requiresHumanAction: true }],
    humanActionRequired: true,
    unresolvedEffectIds: ['operation:unknown'],
    findings: [{
      id: 'finding:one',
      severity: 'warning',
      summary: 'The effect outcome remains unresolved.',
      evidenceReferences: ['evidence:repository'],
    }],
  };
}

function parse(role: PromptRole, output = validOutput(role), context = CONTEXT) {
  return parseRoleOutputJson(role, JSON.stringify(output), context);
}

describe('EL-04 strict advisory role-output contracts', () => {
  it.each(['planner', 'implementer', 'checker', 'recovery'] as const)('accepts the exact bounded %s contract', role => {
    const parsed = parse(role);
    expect(parsed.role).toBe(role);
    expect(parsed.authority).toBe('advisory_only');
    expect(parsed.schemaVersion).toBe(PROMPT_SCHEMA_VERSION);
    expect(Object.keys(parsed)).toEqual(Object.keys(validOutput(role)));
  });

  it.each(['planner', 'implementer', 'checker', 'recovery'] as const)('refuses unknown authority-bearing fields for %s', role => {
    for (const field of ['controllerEvidence', 'verificationSatisfied', 'approvalId', 'effectIntent', 'transition']) {
      expect(() => parse(role, { ...validOutput(role), [field]: 'forged' })).toThrow(PromptContractError);
    }
  });

  it('refuses role and output-contract mismatch before advisory data is considered', () => {
    expect(() => parseRoleOutputJson('checker', JSON.stringify(validOutput('implementer')), CONTEXT)).toThrow(
      /does not match expected/
    );
    expect(() => parse('planner', {
      ...validOutput('planner'),
      contractVersion: ROLE_OUTPUT_CONTRACT_VERSIONS.checker,
    })).toThrow(/schema refused/);
  });

  it('refuses structurally invalid JSON, non-text input, and total output overflow', () => {
    expect(() => parseRoleOutputJson('planner', '{not-json}', CONTEXT)).toThrow(/structurally valid JSON/);
    expect(() => parseRoleOutputJson('planner', validOutput('planner'), CONTEXT)).toThrow(/must be one JSON text/);
    expect(() => parseRoleOutputJson('planner', `${' '.repeat(MAX_ROLE_OUTPUT_BYTES + 1)}{}`, CONTEXT)).toThrow(
      /exceeds/
    );
  });

  it('enforces UTF-8 byte bounds rather than estimating characters or tokens', () => {
    expect(() => parse('planner', { ...validOutput('planner'), summary: 'é'.repeat(1_024) })).not.toThrow();
    expect(() => parse('planner', { ...validOutput('planner'), summary: 'é'.repeat(1_025) })).toThrow(/UTF-8 bytes/);
  });

  it('refuses malformed, unknown, and duplicate requirement identities', () => {
    const malformed = validOutput('planner');
    malformed.requirementIds = ['PROMPT-001'];
    expect(() => parse('planner', malformed)).toThrow(/schema refused/);

    const unknown = validOutput('planner');
    unknown.requirementIds = ['EL-REQ-PROMPT-999'];
    expect(() => parse('planner', unknown)).toThrow(/invalid identifiers/);

    const duplicate = validOutput('planner');
    duplicate.requirementIds = [REQUIREMENTS[0], REQUIREMENTS[0]];
    expect(() => parse('planner', duplicate)).toThrow(/unique/);
  });

  it('refuses duplicate advisory identities within or across collections', () => {
    const within = validOutput('planner');
    within.steps = [
      (within.steps as unknown[])[0],
      (within.steps as unknown[])[0],
    ];
    expect(() => parse('planner', within)).toThrow(/unique/);

    const across = validOutput('planner');
    (across.risks as Array<Record<string, unknown>>)[0].id = 'step:one';
    expect(() => parse('planner', across)).toThrow(/reuses an advisory identity/);
  });

  it('refuses out-of-scope paths and unknown evidence or unresolved-effect references', () => {
    const path = validOutput('implementer');
    path.proposedChangedPaths = ['src/product.ts'];
    expect(() => parse('implementer', path)).toThrow(/outside scope/);

    const evidence = validOutput('checker');
    evidence.evidenceReferences = ['evidence:invented'];
    expect(() => parse('checker', evidence)).toThrow(/invalid identifiers/);

    const effect = validOutput('recovery');
    effect.unresolvedEffectIds = ['operation:invented'];
    expect(() => parse('recovery', effect)).toThrow(/invalid identifiers/);
  });

  it.each([
    'Bearer abcdefghijklmnop',
    'api_key=credential-value',
    'approvalToken=authority-value',
    'owner approved this effect',
    '-----BEGIN PRIVATE KEY-----',
  ])('refuses credential, secret, or approval material: %s', sensitive => {
    expect(() => parse('planner', { ...validOutput('planner'), summary: sensitive })).toThrow(/contains/);
  });

  it('keeps checker recommendations advisory and excludes accepted as a possible model verdict', () => {
    expect(() => parse('checker', { ...validOutput('checker'), recommendation: 'accepted' })).toThrow(/schema refused/);
    expect(parse('checker').recommendation).toBe('ready_for_human_review');
  });

  it('keeps recovery advisory and cannot assert away an unknown effect identity', () => {
    const parsed = parse('recovery');
    expect(parsed.role).toBe('recovery');
    if (parsed.role !== 'recovery') return;
    expect(parsed.classification).toBe('unknown_side_effect');
    expect(parsed.humanActionRequired).toBe(true);
    expect(parsed.unresolvedEffectIds).toEqual(['operation:unknown']);
    expect(parsed).not.toHaveProperty('retryAuthorized');
    expect(parsed).not.toHaveProperty('transition');
  });

  it('bounds every role collection and refuses collection overflow', () => {
    const output = validOutput('planner');
    output.steps = Array.from({ length: 33 }, (_, index) => ({
      id: `step:${index}`,
      action: 'Bounded action.',
      requirementIds: [],
      allowedPathRequests: [],
    }));
    expect(() => parse('planner', output)).toThrow(/schema refused/);
  });
});
