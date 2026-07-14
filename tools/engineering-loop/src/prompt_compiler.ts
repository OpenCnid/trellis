import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import {
  CompiledPromptPacketSchema,
  MAX_PROMPT_BYTES,
  PROMPT_ASSET_VERSIONS,
  PROMPT_COMPILER_VERSION,
  PROMPT_PACKET_VERSION,
  PROMPT_POLICY_VERSION,
  PROMPT_SCHEMA_VERSION,
  PromptCompilationInputSchema,
  PromptCompilationRefusalSchema,
  PromptCompilationResultSchema,
  PromptRoleSchema,
  ROLE_OUTPUT_CONTRACT_VERSIONS,
  assertNoSensitiveMaterial,
  findSensitiveMaterial,
  type CompiledPromptPacket,
  type PromptAsset,
  type PromptCompilationInput,
  type PromptCompilationRefusal,
  type PromptCompilationResult,
  type PromptRole,
} from './prompt_contracts.js';
import { canonicalJson, sha256Canonical } from './events.js';
import { isPathWithinScope } from './path_scope.js';

export const PROMPT_ASSET_PINS = {
  planner: {
    path: 'tools/engineering-loop/prompts/planner.md',
    version: PROMPT_ASSET_VERSIONS.planner,
    digest: '6d9dda932722b7a170b94392caea8e5717d43294f74425ad3416144485de6016',
  },
  implementer: {
    path: 'tools/engineering-loop/prompts/implementer.md',
    version: PROMPT_ASSET_VERSIONS.implementer,
    digest: '58187289e42881e11c3e9dafce617fdd531ff9915f73eae4d95f0693d0402886',
  },
  checker: {
    path: 'tools/engineering-loop/prompts/checker.md',
    version: PROMPT_ASSET_VERSIONS.checker,
    digest: 'dd4cf71a9fbf7fbb9fd429fc4d5ce0452d55ab053e1369d4c905ae613019dca9',
  },
  recovery: {
    path: 'tools/engineering-loop/prompts/recovery.md',
    version: PROMPT_ASSET_VERSIONS.recovery,
    digest: '67d14e2a09a8cacdf680d0493081a0c74e52d69ca38f83108e8031e14ded2ed5',
  },
} as const satisfies Record<PromptRole, { path: string; version: string; digest: string }>;

export interface PromptContaminationFinding {
  code:
    | 'concrete_example'
    | 'concrete_feature_fact'
    | 'repository_fact'
    | 'approval_or_secret'
    | 'transcript'
    | 'diff_or_output'
    | 'mutable_session_claim'
    | 'out_of_layer_placeholder';
  message: string;
}

const CONTAMINATION_PATTERNS: ReadonlyArray<{
  code: Exclude<PromptContaminationFinding['code'], 'approval_or_secret'>;
  message: string;
  pattern: RegExp;
}> = [
  { code: 'concrete_example', message: 'contains a concrete example or sample block', pattern: /^#{1,6}\s+(?:worked\s+)?(?:example|sample)\b/im },
  { code: 'concrete_example', message: 'contains a concrete input or output example', pattern: /^(?:input|output)\s*:\s*(?:["'`{\[]|\S+\s*->)/im },
  { code: 'concrete_feature_fact', message: 'contains a concrete feature or requirement instance', pattern: /\b(?:EL-[0-9]{2}|EL-REQ-[A-Z]+-[0-9]{3})\b/ },
  { code: 'repository_fact', message: 'contains a concrete commit identity', pattern: /\b[0-9a-f]{40}(?:[0-9a-f]{24})?\b/i },
  { code: 'repository_fact', message: 'contains a concrete absolute repository path', pattern: /(?:\b[A-Za-z]:[\\/][^\r\n]+|(?:^|\s)\/(?:home|Users|workspace|repo)\/[^\r\n]+)/m },
  { code: 'repository_fact', message: 'contains a concrete repository-relative path instance', pattern: /\b(?:src|tools|docs|scripts|modules)\/[A-Za-z0-9_.\/-]+/ },
  { code: 'transcript', message: 'contains a raw transcript turn', pattern: /^(?:user|assistant|system|tool)\s*:/im },
  { code: 'diff_or_output', message: 'contains raw diff material', pattern: /^(?:diff --git|@@\s+-[0-9])/m },
  { code: 'diff_or_output', message: 'contains captured command or runner output', pattern: /(?:^|\n)(?:stdout|stderr|TRELLIS_RESULT|TRELLIS_TELEMETRY)\s*[:=]/i },
  { code: 'mutable_session_claim', message: 'contains a mutable session claim', pattern: /\b(?:current|this)\s+(?:session|feature|branch|commit|head|worktree)\b/i },
  { code: 'mutable_session_claim', message: 'contains a concrete session date', pattern: /\b20[0-9]{2}-[01][0-9]-[0-3][0-9]\b/ },
  { code: 'out_of_layer_placeholder', message: 'contains a mutable placeholder outside typed context', pattern: /(?:\$\{|\{\{|<<[A-Z0-9_]+>>|\[[A-Z][A-Za-z0-9_ ]+\])/ },
];

const utf8 = new TextDecoder('utf-8', { fatal: true });

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function boundedObservedBytes(value: number): number {
  return Math.min(value, MAX_PROMPT_BYTES + 1);
}

export function normalizePromptAssetBytes(byteValue: Uint8Array): Buffer {
  if (!(byteValue instanceof Uint8Array)) throw new Error('Prompt asset normalization requires bytes');
  let bytes = Buffer.from(byteValue);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bytes = bytes.subarray(3);
  }
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    throw new Error('Prompt asset is not valid UTF-8');
  }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n*$/, '');
  if (text.length === 0 || text.includes('\0')) throw new Error('Prompt asset is empty or contains NUL');
  return Buffer.from(`${text}\n`, 'utf8');
}

export function isNormalizedPromptAssetBytes(bytes: Uint8Array): boolean {
  const input = Buffer.from(bytes);
  try {
    return input.equals(normalizePromptAssetBytes(input));
  } catch {
    return false;
  }
}

export function scanReusablePromptAsset(text: string): PromptContaminationFinding[] {
  const findings: PromptContaminationFinding[] = [];
  const sensitive = findSensitiveMaterial(text);
  if (sensitive !== null) {
    findings.push({ code: 'approval_or_secret', message: `contains ${sensitive.pattern}` });
  }
  for (const candidate of CONTAMINATION_PATTERNS) {
    if (candidate.pattern.test(text)) findings.push({ code: candidate.code, message: candidate.message });
  }
  return findings;
}

export function createPinnedPromptAsset(roleValue: unknown, byteValue: Uint8Array): PromptAsset {
  const role = PromptRoleSchema.parse(roleValue);
  const normalized = normalizePromptAssetBytes(byteValue);
  const digest = sha256Bytes(normalized);
  const pin = PROMPT_ASSET_PINS[role];
  if (digest !== pin.digest) {
    throw new Error(`Prompt asset digest mismatch for role '${role}'`);
  }
  const text = normalized.toString('utf8');
  const contamination = scanReusablePromptAsset(text);
  if (contamination.length > 0) {
    throw new Error(`Prompt asset contamination for role '${role}': ${contamination.map(item => item.code).join(', ')}`);
  }
  return {
    role,
    version: pin.version,
    digest,
    text,
  };
}

function canonicalPromptJson(value: unknown): string {
  return canonicalJson(value).replace(/[<>&\u2028\u2029]/g, character => {
    const code = character.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${code}`;
  });
}

function typedSection(name: string, value: unknown): string {
  return `<context_collection name="${name}">\n${canonicalPromptJson(value)}\n</context_collection>\n`;
}

function firstInputIssue(inputValue: unknown): string {
  const parsed = PromptCompilationInputSchema.safeParse(inputValue);
  if (parsed.success) return 'prompt input validation failed';
  return parsed.error.issues
    .slice(0, 3)
    .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ')
    .slice(0, 900);
}

function partialRole(value: unknown): PromptRole | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = PromptRoleSchema.safeParse((value as Record<string, unknown>).role);
  return candidate.success ? candidate.data : null;
}

function makeRefusal(input: {
  inputValue: unknown;
  code: PromptCompilationRefusal['code'];
  message: string;
  section?: PromptCompilationRefusal['section'];
  limitBytes?: number | null;
  observedBytes?: number | null;
  freshEpisodeRequired?: boolean;
}): PromptCompilationResult {
  const inputRecord = input.inputValue !== null && typeof input.inputValue === 'object'
    ? input.inputValue as Record<string, unknown>
    : {};
  const material = {
    schemaVersion: PROMPT_SCHEMA_VERSION,
    packetVersion: PROMPT_PACKET_VERSION,
    compilerVersion: PROMPT_COMPILER_VERSION,
    policyVersion: inputRecord.policyVersion === PROMPT_POLICY_VERSION ? PROMPT_POLICY_VERSION : null,
    role: partialRole(input.inputValue),
    code: input.code,
    section: input.section ?? null,
    limitBytes: input.limitBytes ?? null,
    observedBytes: input.observedBytes == null ? null : boundedObservedBytes(input.observedBytes),
    freshEpisodeRequired: input.freshEpisodeRequired ?? false,
    message: input.message.slice(0, 1_024),
  };
  const refusal = PromptCompilationRefusalSchema.parse({
    ...material,
    digest: sha256Canonical(material),
  });
  return PromptCompilationResultSchema.parse({ status: 'refused', refusal });
}

function exactOrderedIds(expected: readonly string[], observed: readonly string[]): boolean {
  return canonicalJson(expected) === canonicalJson(observed);
}

function validateIdentities(input: PromptCompilationInput): string | null {
  const evidenceIds = input.controllerEvidence.map(item => item.id);
  if (!exactOrderedIds(input.validatedState.linkedEvidenceIds, evidenceIds)) {
    return 'validated state evidence links do not exactly match ordered controller evidence';
  }
  for (const evidence of input.controllerEvidence) {
    if (
      evidence.workflowId !== input.validatedState.workflowId
      || evidence.featureId !== input.validatedState.feature.id
      || evidence.sessionId !== input.validatedState.sessionId
    ) {
      return `controller evidence '${evidence.id}' is not bound to the validated workflow, feature, and session`;
    }
  }
  const globalIds = [
    input.validatedState.snapshotId,
    input.activePlan.id,
    ...input.invariantPolicy.map(item => item.id),
    ...evidenceIds,
    ...input.episodeSummary.map(item => item.id),
    ...input.archiveReferences.map(item => item.id),
  ];
  if (new Set(globalIds).size !== globalIds.length) {
    return 'prompt input reuses an identity across context collections';
  }
  const featureRequirements = new Set(input.validatedState.feature.requirementIds);
  const planRequirements = new Set(input.activePlan.requirementIds);
  if (input.activePlan.requirementIds.some(id => !featureRequirements.has(id))) {
    return 'active plan contains a requirement outside the validated feature definition';
  }
  if (input.activePlan.allowedPaths.some(path => (
    !input.validatedState.feature.allowedPaths.some(scope => isPathWithinScope(path, scope))
  ))) {
    return 'active plan contains a path outside the validated feature scope';
  }
  for (const step of input.activePlan.steps) {
    if (step.requirementIds.some(id => !planRequirements.has(id))) {
      return `plan step '${step.id}' contains a requirement outside the active plan`;
    }
    if (step.allowedPaths.some(path => !input.activePlan.allowedPaths.some(scope => isPathWithinScope(path, scope)))) {
      return `plan step '${step.id}' contains a path outside the active plan`;
    }
  }
  const { digest, ...planMaterial } = input.activePlan;
  if (digest !== sha256Canonical(planMaterial)) {
    return 'active plan digest does not match its canonical typed content';
  }
  return null;
}

function compileValidated(input: PromptCompilationInput, asset: PromptAsset): PromptCompilationResult {
  const metadata = {
    schema_version: PROMPT_SCHEMA_VERSION,
    packet_version: PROMPT_PACKET_VERSION,
    compiler_version: PROMPT_COMPILER_VERSION,
    policy_version: PROMPT_POLICY_VERSION,
    role: input.role,
    asset_version: asset.version,
    asset_digest: asset.digest,
    output_contract_version: input.outputContractVersion,
    section_budgets: input.budget.sectionBytes,
    total_budget: input.budget.totalBytes,
  };
  const sections = {
    invariantFrame: asset.text,
    packetMetadata: `<typed_packet_metadata>\n${canonicalPromptJson(metadata)}\n</typed_packet_metadata>\n`,
    invariantPolicy: typedSection('invariant_policy', input.invariantPolicy),
    validatedState: typedSection('validated_state', input.validatedState),
    activePlan: typedSection('active_plan', input.activePlan),
    controllerEvidence: typedSection('controller_evidence', input.controllerEvidence),
    episodeSummary: typedSection('episode_summary', input.episodeSummary),
    archiveReferences: typedSection('archive_references', input.archiveReferences),
  };
  const sectionBytes = Object.fromEntries(
    Object.entries(sections).map(([name, text]) => [name, Buffer.byteLength(text, 'utf8')])
  ) as Record<keyof typeof sections, number>;
  for (const name of Object.keys(sections) as Array<keyof typeof sections>) {
    const limit = input.budget.sectionBytes[name];
    const observed = sectionBytes[name];
    if (observed > limit) {
      return makeRefusal({
        inputValue: input,
        code: 'section_overflow',
        section: name,
        limitBytes: limit,
        observedBytes: observed,
        freshEpisodeRequired: name === 'episodeSummary',
        message: `prompt section '${name}' exceeds its explicit UTF-8 byte budget`,
      });
    }
  }
  const prompt = [
    sections.invariantFrame,
    sections.packetMetadata,
    '<typed_downstream_context>\n',
    sections.invariantPolicy,
    sections.validatedState,
    sections.activePlan,
    sections.controllerEvidence,
    sections.episodeSummary,
    sections.archiveReferences,
    '</typed_downstream_context>\n',
  ].join('');
  const byteCount = Buffer.byteLength(prompt, 'utf8');
  if (byteCount > input.budget.totalBytes) {
    return makeRefusal({
      inputValue: input,
      code: 'total_overflow',
      section: 'total',
      limitBytes: input.budget.totalBytes,
      observedBytes: byteCount,
      freshEpisodeRequired: true,
      message: 'compiled prompt exceeds the explicit total UTF-8 byte budget; start a fresh bounded episode',
    });
  }
  const packet: CompiledPromptPacket = CompiledPromptPacketSchema.parse({
    schemaVersion: PROMPT_SCHEMA_VERSION,
    packetVersion: PROMPT_PACKET_VERSION,
    compilerVersion: PROMPT_COMPILER_VERSION,
    policyVersion: PROMPT_POLICY_VERSION,
    role: input.role,
    assetVersion: asset.version,
    assetDigest: asset.digest,
    outputContractVersion: ROLE_OUTPUT_CONTRACT_VERSIONS[input.role],
    snapshotId: input.validatedState.snapshotId,
    snapshotDigest: input.validatedState.snapshotDigest,
    featureId: input.validatedState.feature.id,
    evidenceIds: input.controllerEvidence.map(item => item.id),
    byteCount,
    maxByteCount: input.budget.totalBytes,
    sectionBytes,
    sectionBudgets: input.budget.sectionBytes,
    digest: sha256Bytes(Buffer.from(prompt, 'utf8')),
    prompt,
  });
  return PromptCompilationResultSchema.parse({ status: 'compiled', packet });
}

export function compilePromptPacket(inputValue: unknown, assetBytesValue: Uint8Array): PromptCompilationResult {
  const parsedInput = PromptCompilationInputSchema.safeParse(inputValue);
  if (!parsedInput.success) {
    return makeRefusal({
      inputValue,
      code: 'invalid_input',
      message: `prompt compilation input refused: ${firstInputIssue(inputValue)}`,
    });
  }
  const input = parsedInput.data;
  try {
    assertNoSensitiveMaterial(input, 'prompt compilation input');
  } catch (error) {
    return makeRefusal({
      inputValue: input,
      code: 'contamination',
      message: error instanceof Error ? error.message : 'prompt input contains sensitive material',
    });
  }
  const identityError = validateIdentities(input);
  if (identityError !== null) {
    return makeRefusal({ inputValue: input, code: 'identity_mismatch', message: identityError });
  }
  let asset: PromptAsset;
  try {
    asset = createPinnedPromptAsset(input.role, assetBytesValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'prompt asset validation failed';
    return makeRefusal({
      inputValue: input,
      code: message.includes('contamination') ? 'contamination' : 'asset_mismatch',
      section: 'invariantFrame',
      message,
    });
  }
  if (
    asset.role !== input.role
    || asset.version !== input.roleAsset.version
    || asset.digest !== input.roleAsset.digest
  ) {
    return makeRefusal({
      inputValue: input,
      code: 'asset_mismatch',
      section: 'invariantFrame',
      message: 'supplied role asset identity disagrees with the validated compiler input',
    });
  }
  return compileValidated(input, asset);
}
