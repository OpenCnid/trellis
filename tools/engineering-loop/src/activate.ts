import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve, win32 } from 'node:path';
import { z } from 'zod';
import {
  MAX_PATH_LENGTH,
  RepositoryObservationSchema,
  StableIdSchema,
  parseBoundary,
  type RepositoryObservation,
} from './domain.js';
import { canonicalJson } from './events.js';
import { validateProtectedStateRoot } from './state_store.js';
import { BoundedCommandExecutor, ProtectedArtifactStore } from './command_evidence.js';
import { RepositoryObserver } from './repo_observer.js';
import {
  AcceptanceLedger,
  FeatureStatusSchema,
  PROGRAM_ACCEPTANCE_WORKFLOW_ID,
  admissibleLedgerCeremonies,
  catalogDigestOf,
  catalogProvenanceNotes,
  resolveFeatureStatus,
  type LedgerCeremony,
} from './acceptance_ledger.js';
import { FileProtectedApprovalChannel } from './approval_channel.js';
import {
  SEED_SCOPE_SEPARATOR,
  SEED_SESSION_ID,
  buildSeedRequest,
  catalogStatusPairs,
  seedAcceptanceLedger,
  type CatalogStatusPair,
} from './seed.js';
import {
  ACCEPTANCE_CHANGE_FEATURE_ID,
  ACCEPTANCE_CHANGE_SESSION_ID,
  buildAcceptanceChangeRequest,
  canonicalStatusPairs,
  recordAcceptanceChange,
} from './acceptance_change.js';
import {
  LedgerRecoveryRefusedError,
  ReconciliationScopeItemSchema,
  buildGenesisRequest,
  buildLedgerRecoveryRequest,
  recoverLedgerContent,
  reGenesisLedger,
  type ReconciliationScopeItem,
} from './ledger_recovery.js';
import { protectedRequestDigest } from './policy.js';

/**
 * The startup entrypoint (EL-REQ-BOOT-001).
 *
 * EL-02 through EL-06 built a correct, thoroughly tested, entirely inert
 * library: `StateStore.open()` took a caller-supplied root with no default, and
 * every caller was a test using a temporary directory. The kernel was correct
 * and unreachable, and no test could fail because none asserted a non-test
 * caller existed. This module is that caller.
 */

export const ACTIVATION_VERSION = 'trellis-engineering-loop-activation:v1' as const;

export const ACTIVATION_ENVIRONMENT_KEYS = {
  ledgerRoot: 'TRELLIS_EL_LEDGER_ROOT',
  stateRoot: 'TRELLIS_EL_STATE_ROOT',
  worktree: 'TRELLIS_EL_WORKTREE',
  approvalChannel: 'TRELLIS_EL_APPROVAL_CHANNEL',
} as const;

export class ActivationConfigError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'ActivationConfigError';
  }
}

const AbsolutePathSchema = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine(value => isAbsolute(value), 'must be an absolute path');

export const ActivationConfigSchema = z.strictObject({
  ledgerRoot: AbsolutePathSchema,
  stateRoot: AbsolutePathSchema,
  worktree: AbsolutePathSchema,
  approvalChannel: AbsolutePathSchema,
});
export type ActivationConfig = z.infer<typeof ActivationConfigSchema>;

/**
 * Resolves all four locations from explicit configuration and refuses to start
 * when any is absent or ambiguous. "Ambiguous" is not a synonym for "missing":
 * two roles resolving to the same directory would silently couple
 * program-scoped acceptance to workflow-scoped execution through a shared
 * `.writer.lock`, so it is refused by name.
 */
export function readActivationConfig(environment: Record<string, string | undefined>): ActivationConfig {
  const missing = Object.entries(ACTIVATION_ENVIRONMENT_KEYS)
    .filter(([, key]) => {
      const value = environment[key];
      return value === undefined || value.trim().length === 0;
    })
    .map(([, key]) => key);
  if (missing.length > 0) {
    throw new ActivationConfigError(
      `Controller activation requires explicit configuration; absent: ${missing.sort().join(', ')}`
    );
  }

  const parsed = ActivationConfigSchema.safeParse({
    ledgerRoot: environment[ACTIVATION_ENVIRONMENT_KEYS.ledgerRoot],
    stateRoot: environment[ACTIVATION_ENVIRONMENT_KEYS.stateRoot],
    worktree: environment[ACTIVATION_ENVIRONMENT_KEYS.worktree],
    approvalChannel: environment[ACTIVATION_ENVIRONMENT_KEYS.approvalChannel],
  });
  if (!parsed.success) {
    throw new ActivationConfigError(
      `Controller activation configuration is invalid: ${parsed.error.issues
        .slice(0, 4)
        .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`
    );
  }

  const config = parsed.data;
  const roles: Array<[keyof ActivationConfig, string]> = [
    ['ledgerRoot', resolve(config.ledgerRoot)],
    ['stateRoot', resolve(config.stateRoot)],
    ['approvalChannel', resolve(config.approvalChannel)],
  ];
  for (let i = 0; i < roles.length; i++) {
    for (let j = i + 1; j < roles.length; j++) {
      if (roles[i][1] === roles[j][1]) {
        throw new ActivationConfigError(
          `Controller activation configuration is ambiguous: ${roles[i][0]} and ${roles[j][0]} resolve to the same path`
        );
      }
    }
  }
  return config;
}

export interface ResolvedActivation {
  config: ActivationConfig;
  ledgerRoot: string;
  stateRoot: string;
  worktree: string;
  approvalChannel: string;
  /**
   * Roles whose configured path is not the path it actually resolved to.
   *
   * A containerized host redirects writes to per-user application-data
   * directories into a private package cache, so the same configuration means a
   * different directory to the controller than to an operator in an
   * uncontainerized shell. Both sides then see a coherent, empty, disagreeing
   * ledger. The divergence is reported rather than refused: a symbolic link is a
   * legitimate redirect and `validateProtectedStateRoot` already judges whether
   * a root is safe. What must never happen is that it passes unnoticed.
   */
  redirects: readonly { role: string; configured: string; resolved: string }[];
}

function redirectOf(role: string, configured: string, resolved: string) {
  return resolve(configured) === resolved ? null : { role, configured: resolve(configured), resolved };
}

/**
 * Every root crosses `validateProtectedStateRoot` (EL-REQ-STORE-001), which
 * refuses a root that is inside, aliases into, or is reachable by symbolic link
 * from the assigned worktree.
 */
export async function resolveActivation(config: ActivationConfig): Promise<ResolvedActivation> {
  const worktree = resolve(config.worktree);
  const ledgerRoot = await validateProtectedStateRoot(config.ledgerRoot, worktree);
  const stateRoot = await validateProtectedStateRoot(config.stateRoot, worktree);
  const approvalChannel = await validateProtectedStateRoot(config.approvalChannel, worktree);
  const redirects = [
    redirectOf('ledgerRoot', config.ledgerRoot, ledgerRoot),
    redirectOf('stateRoot', config.stateRoot, stateRoot),
    redirectOf('approvalChannel', config.approvalChannel, approvalChannel),
  ].filter((entry): entry is { role: string; configured: string; resolved: string } => entry !== null);
  return { config, ledgerRoot, stateRoot, worktree, approvalChannel, redirects };
}

export interface ActivationStatus {
  version: typeof ACTIVATION_VERSION;
  ledgerRoot: string;
  stateRoot: string;
  worktree: string;
  approvalChannel: string;
  redirects: readonly { role: string; configured: string; resolved: string }[];
  generation: number;
  /**
   * Every ceremony this generation admits, not one.
   *
   * A healthy populated ledger admits two — recording new information and
   * correcting wrong information — and reporting only `ledger_recovery` told an
   * operator that a corruption ceremony was the sole thing available on a ledger
   * that was working perfectly.
   */
  ceremonies: readonly LedgerCeremony[];
  recordCount: number;
  integrity: 'valid' | 'broken';
  breach: unknown;
  acceptedFeatureIds: readonly string[];
  statuses: Record<string, string>;
  notes: readonly string[];
}

export async function readCatalog(worktree: string): Promise<unknown> {
  const path = resolve(worktree, 'docs/product/engineering-loop/features.json');
  return JSON.parse(await readFile(path, 'utf8'));
}

/**
 * Inputs the seeding commands need beyond the four protected locations.
 *
 * `createdAt` is explicit rather than defaulted to the clock because the
 * request digest covers it. If `seed` re-composed the request with a fresh
 * timestamp, the digest would drift and the owner's approval — authored against
 * the printed digest — would never match. Print and seed must compose byte-
 * identical requests, so the timestamp is carried, not regenerated.
 *
 * The branch, base commit, and remote identity are declarations the observer
 * verifies against the real repository and refuses on mismatch. They are not
 * trusted inputs; they are expectations the engine checks.
 */
const BranchArgumentSchema = z.string().min(1).max(256);
const BaseCommitArgumentSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, 'must be a full Git commit identity');
const RemoteNameArgumentSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const RemoteUrlArgumentSchema = z.string().min(1).max(2_048);
const ApprovalIdArgumentSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'must be a stable identifier');
const CreatedAtArgumentSchema = z.string().datetime({ offset: true });

export const SeedArgumentsSchema = z.strictObject({
  branch: BranchArgumentSchema,
  baseCommit: BaseCommitArgumentSchema,
  remoteName: RemoteNameArgumentSchema,
  remoteUrl: RemoteUrlArgumentSchema,
  approvalId: ApprovalIdArgumentSchema,
  createdAt: CreatedAtArgumentSchema,
});
export type SeedArguments = z.infer<typeof SeedArgumentsSchema>;

const SEED_FLAGS = {
  '--branch': 'branch',
  '--base': 'baseCommit',
  '--remote-name': 'remoteName',
  '--remote-url': 'remoteUrl',
  '--approval-id': 'approvalId',
  '--created-at': 'createdAt',
} as const;

export function parseSeedArguments(
  argv: readonly string[],
  defaults: Partial<SeedArguments> = {}
): SeedArguments {
  const collected: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    const key = SEED_FLAGS[flag as keyof typeof SEED_FLAGS];
    if (key === undefined) throw new ActivationConfigError(`Unknown or malformed seed argument '${flag}'`);
    if (value === undefined) throw new ActivationConfigError(`Seed argument '${flag}' requires a value`);
    if (collected[key] !== undefined) throw new ActivationConfigError(`Seed argument '${flag}' is repeated`);
    collected[key] = value;
  }
  const parsed = SeedArgumentsSchema.safeParse({ ...defaults, ...collected });
  if (!parsed.success) {
    throw new ActivationConfigError(
      `Seed arguments are invalid or incomplete: ${parsed.error.issues
        .slice(0, 4)
        .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return parsed.data;
}

/**
 * One `--set EL-10=accepted` item, parsed into the pair the scope grammar names.
 *
 * The separator is `SEED_SCOPE_SEPARATOR`, so what an owner types on the command
 * line, what the request's `exactScope` carries, and what the approval material
 * must match are one grammar rather than three that can drift.
 */
export function parseStatusPair(text: string): CatalogStatusPair {
  const separator = text.indexOf(SEED_SCOPE_SEPARATOR);
  if (separator <= 0 || separator === text.length - 1) {
    throw new ActivationConfigError(
      `Status pair '${text}' is malformed; the form is <featureId>${SEED_SCOPE_SEPARATOR}<status>, for example EL-10${SEED_SCOPE_SEPARATOR}accepted`
    );
  }
  const featureId = text.slice(0, separator);
  const status = text.slice(separator + 1);
  const parsed = FeatureStatusSchema.safeParse(status);
  if (!parsed.success) {
    throw new ActivationConfigError(
      `Status '${status}' in pair '${text}' is not one of: ${FeatureStatusSchema.options.join(', ')}`
    );
  }
  return { featureId: parseBoundary(StableIdSchema, featureId, 'status pair feature identity'), status: parsed.data };
}

export interface AcceptanceChangeArguments extends SeedArguments {
  pairs: readonly CatalogStatusPair[];
}

/**
 * `parseSeedArguments` plus a repeatable `--set`. Seeding reads its pairs from a
 * status document; a steady-state change cannot, because status no longer lives
 * in any document the controller holds — it lives in the ledger, and the change
 * itself is the owner's decision. So the pairs are stated explicitly on the
 * command line and are never defaulted.
 */
export function parseAcceptanceChangeArguments(
  argv: readonly string[],
  defaults: Partial<SeedArguments> = {}
): AcceptanceChangeArguments {
  const seedArgv: string[] = [];
  const pairs: CatalogStatusPair[] = [];
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--set') {
      if (value === undefined) throw new ActivationConfigError(`Acceptance change argument '--set' requires a value`);
      pairs.push(parseStatusPair(value));
      continue;
    }
    seedArgv.push(flag, ...(value === undefined ? [] : [value]));
  }
  if (pairs.length === 0) {
    throw new ActivationConfigError(
      'An acceptance change requires at least one --set <featureId>=<status>; the controller never infers a status change.'
    );
  }
  return { ...parseSeedArguments(seedArgv, defaults), pairs };
}

/**
 * One `--supersede EL-07=planned:2,5` item: the feature, its corrected status,
 * and the exact superseded sequences.
 *
 * The `<featureId>=<status>` head reuses `parseStatusPair`, so the pair grammar
 * an owner already knows from `--set` is the same one here; only the trailing
 * `:<sequence[,sequence...]>` is new. The colon is searched after the `=`
 * because a feature identity may itself contain colons and a status never does.
 */
export function parseReconciliationItem(text: string): ReconciliationScopeItem {
  const equals = text.indexOf(SEED_SCOPE_SEPARATOR);
  const colon = text.indexOf(':', equals + 1);
  if (equals <= 0 || colon <= equals + 1 || colon === text.length - 1) {
    throw new ActivationConfigError(
      `Supersede item '${text}' is malformed; the form is <featureId>${SEED_SCOPE_SEPARATOR}<status>:<sequence[,sequence...]>, for example EL-07${SEED_SCOPE_SEPARATOR}planned:2`
    );
  }
  const pair = parseStatusPair(text.slice(0, colon));
  const supersedes: number[] = [];
  for (const sequence of text.slice(colon + 1).split(',')) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(sequence)) {
      throw new ActivationConfigError(
        `Supersede item '${text}' names sequence '${sequence}', which is not a nonnegative integer`
      );
    }
    supersedes.push(Number(sequence));
  }
  return parseBoundary(
    ReconciliationScopeItemSchema,
    { featureId: pair.featureId, status: pair.status, supersedes },
    'supersede scope item'
  );
}

export interface RecoveryArguments extends SeedArguments {
  scope: readonly ReconciliationScopeItem[];
  issuer?: string;
  signatureReference?: string;
  evidenceReference?: string;
  evidenceDigest?: string;
  reason?: string;
}

const RECOVERY_OWNER_FLAGS = {
  '--issuer': 'issuer',
  '--signature-ref': 'signatureReference',
  '--evidence-ref': 'evidenceReference',
  '--evidence-digest': 'evidenceDigest',
  '--reason': 'reason',
} as const;

/**
 * `parseSeedArguments` plus a repeatable `--supersede` and the owner-supplied
 * reconciliation material. The five owner fields are optional at parse time
 * because `print-recovery-request` composes the digest-bearing request without
 * them — they enter the reconciliation record, not the request scope — and
 * requiring them for a print would withhold preparatory work the controller can
 * discharge (`EL-REQ-APPROVAL-012`). `recover` refuses their absence by name.
 */
export function parseRecoveryArguments(
  argv: readonly string[],
  defaults: Partial<SeedArguments> = {}
): RecoveryArguments {
  const seedArgv: string[] = [];
  const scope: ReconciliationScopeItem[] = [];
  const owner: Partial<Record<(typeof RECOVERY_OWNER_FLAGS)[keyof typeof RECOVERY_OWNER_FLAGS], string>> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--supersede') {
      if (value === undefined) throw new ActivationConfigError(`Recovery argument '--supersede' requires a value`);
      scope.push(parseReconciliationItem(value));
      continue;
    }
    const key = RECOVERY_OWNER_FLAGS[flag as keyof typeof RECOVERY_OWNER_FLAGS];
    if (key !== undefined) {
      if (value === undefined) throw new ActivationConfigError(`Recovery argument '${flag}' requires a value`);
      if (owner[key] !== undefined) throw new ActivationConfigError(`Recovery argument '${flag}' is repeated`);
      owner[key] = value;
      continue;
    }
    seedArgv.push(flag, ...(value === undefined ? [] : [value]));
  }
  if (scope.length === 0) {
    throw new ActivationConfigError(
      'A content reconciliation requires at least one --supersede <featureId>=<status>:<sequence[,sequence...]>; the controller never infers a correction.'
    );
  }
  return {
    ...parseSeedArguments(seedArgv, defaults),
    scope,
    issuer: owner.issuer,
    signatureReference: owner.signatureReference,
    evidenceReference: owner.evidenceReference,
    evidenceDigest: owner.evidenceDigest,
    reason: owner.reason,
  };
}

export const GenesisArgumentsSchema = z.strictObject({
  branch: BranchArgumentSchema,
  baseCommit: BaseCommitArgumentSchema,
  remoteName: RemoteNameArgumentSchema,
  remoteUrl: RemoteUrlArgumentSchema,
  genesisApprovalId: ApprovalIdArgumentSchema,
  seedApprovalId: ApprovalIdArgumentSchema,
  createdAt: CreatedAtArgumentSchema,
  issuer: z.string().min(1).max(128).optional(),
  signatureReference: z.string().min(1).max(1_024).optional(),
  reconstructionBasis: z.string().min(1).max(2_048).optional(),
}).superRefine((args, ctx) => {
  // Two roles, two owner decisions, two channel records. One identity cannot
  // cover both: `authorizeProtectedAction` matches action and request digest
  // exactly, and the genesis request (`ledger_recovery`, the break point) and
  // the seed request (`acceptance_change`, the reconstruction pairs) differ in
  // both. Refusing the collision at the boundary names the predicate instead of
  // surfacing it later as a generic approval mismatch.
  if (args.genesisApprovalId === args.seedApprovalId) {
    ctx.addIssue({
      code: 'custom',
      path: ['seedApprovalId'],
      message: 'genesis and seed approvals are two distinct owner decisions; one approval identity cannot cover both',
    });
  }
});

export interface GenesisArguments extends z.infer<typeof GenesisArgumentsSchema> {
  pairs: readonly CatalogStatusPair[];
}

const GENESIS_FLAGS = {
  '--branch': 'branch',
  '--base': 'baseCommit',
  '--remote-name': 'remoteName',
  '--remote-url': 'remoteUrl',
  '--created-at': 'createdAt',
  '--genesis-approval-id': 'genesisApprovalId',
  '--seed-approval-id': 'seedApprovalId',
  '--issuer': 'issuer',
  '--signature-ref': 'signatureReference',
  '--reconstruction-basis': 'reconstructionBasis',
} as const;

/**
 * Re-genesis takes its reconstruction `(featureId, status)` pairs from the
 * owner's command line — the reconstruction basis — never from controller-held
 * state, and never from the catalog, which carries no status since the
 * migration. The pairs reuse `--set` and `parseStatusPair`, so the owner reads
 * one pair grammar across every ceremony.
 */
export function parseGenesisArguments(
  argv: readonly string[],
  defaults: Partial<z.infer<typeof GenesisArgumentsSchema>> = {}
): GenesisArguments {
  const collected: Record<string, string> = {};
  const pairs: CatalogStatusPair[] = [];
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--set') {
      if (value === undefined) throw new ActivationConfigError(`Re-genesis argument '--set' requires a value`);
      pairs.push(parseStatusPair(value));
      continue;
    }
    const key = GENESIS_FLAGS[flag as keyof typeof GENESIS_FLAGS];
    if (key === undefined) throw new ActivationConfigError(`Unknown or malformed re-genesis argument '${flag}'`);
    if (value === undefined) throw new ActivationConfigError(`Re-genesis argument '${flag}' requires a value`);
    if (collected[key] !== undefined) throw new ActivationConfigError(`Re-genesis argument '${flag}' is repeated`);
    collected[key] = value;
  }
  if (pairs.length === 0) {
    throw new ActivationConfigError(
      "Re-genesis requires at least one --set <featureId>=<status> reconstruction pair from the owner's reconstruction basis; the controller never derives them from state it holds."
    );
  }
  const parsed = GenesisArgumentsSchema.safeParse({ ...defaults, ...collected });
  if (!parsed.success) {
    throw new ActivationConfigError(
      `Re-genesis arguments are invalid or incomplete: ${parsed.error.issues
        .slice(0, 4)
        .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return { ...parsed.data, pairs };
}

/**
 * Observes the repository through the accepted EL-03 observer rather than
 * reading Git directly. `EL-REQ-REPO-001` requires branch, base, and dirty state
 * to be computed rather than model-authored, and a second definition of
 * `clean` or `repositoryId` beside EL-03's would be free to drift from it
 * silently. The workflow state root — resolved by `EL-REQ-BOOT-001` and
 * otherwise unused until a workflow runs — is where the observer's command
 * evidence is retained.
 */
export const ACTIVATION_ALLOWED_SCOPES = ['tools/engineering-loop', 'package.json'] as const;

export async function observeSeedRepository(input: {
  resolved: ResolvedActivation;
  /** Only the repository expectations; commands carrying other flags reuse this unchanged. */
  args: Pick<SeedArguments, 'branch' | 'baseCommit' | 'remoteName' | 'remoteUrl'>;
  clock: { now(): string };
  /** Default to activation's identities; the steady-state path passes its own. */
  observationId?: string;
  featureId?: string;
  sessionId?: string;
}): Promise<{ observation: RepositoryObservation; commandCount: number }> {
  const artifacts = await ProtectedArtifactStore.open({
    protectedRoot: input.resolved.stateRoot,
    worktree: input.resolved.worktree,
  });
  const observer = new RepositoryObserver(new BoundedCommandExecutor({ clock: input.clock, artifacts }));
  const result = await observer.observe({
    observationId: input.observationId ?? 'repository-observation:el10-activation',
    workflowId: PROGRAM_ACCEPTANCE_WORKFLOW_ID,
    featureId: input.featureId ?? 'EL-10',
    sessionId: input.sessionId ?? SEED_SESSION_ID,
    assignedWorktree: input.resolved.worktree,
    expectedBranch: input.args.branch,
    baseCommit: input.args.baseCommit,
    expectedHead: null,
    remoteName: input.args.remoteName,
    expectedRemoteIdentity: input.args.remoteUrl,
    // EL-10's real footprint: the tool tree plus the npm-script line in
    // package.json. On a clean tree there are no changed paths and this is
    // vacuous; on a dirty tree it refuses an activation run whose worktree
    // carries edits EL-10 does not own.
    allowedScopes: [...ACTIVATION_ALLOWED_SCOPES],
    timeoutMs: 30_000,
  });
  const observed = result.observation;
  return {
    observation: parseBoundary(RepositoryObservationSchema, {
      repositoryId: observed.repositoryId,
      worktreeId: observed.worktreeId,
      branch: observed.branch,
      baseCommit: observed.baseCommit,
      headCommit: observed.headCommit,
      clean: observed.clean,
    }, 'seed repository precondition'),
    commandCount: result.commands.length,
  };
}

/**
 * Read-only inspection: resolves configuration, opens the ledger under its
 * writer lock, and reports the observed generation, ceremony, and resolved
 * status without writing a record.
 */
export async function inspectActivation(input: {
  config: ActivationConfig;
  clock: { now(): string };
  catalog?: unknown;
}): Promise<ActivationStatus> {
  const resolved = await resolveActivation(input.config);
  // Read-only: takes no writer lock, so `status` still reports while a seed
  // holds the lock or a crashed run left one behind. That is exactly when an
  // operator needs it.
  const ledger = await AcceptanceLedger.openReadOnly({
    ledgerRoot: resolved.ledgerRoot,
    worktree: resolved.worktree,
    clock: input.clock,
  });
  try {
    const state = await ledger.readCurrentGeneration();
    const base = {
      version: ACTIVATION_VERSION,
      ledgerRoot: resolved.ledgerRoot,
      stateRoot: resolved.stateRoot,
      worktree: resolved.worktree,
      approvalChannel: resolved.approvalChannel,
      redirects: resolved.redirects,
      generation: state.generation,
      ceremonies: admissibleLedgerCeremonies(state),
      recordCount: state.records.length,
      integrity: state.integrity,
      breach: state.breach,
    } as const;
    if (state.integrity === 'broken') {
      return { ...base, acceptedFeatureIds: [], statuses: {}, notes: [
        'controller:ledger_integrity_stop: resolution stopped; route to EL-REQ-BOOT-007 re-genesis.',
      ] };
    }
    const resolvedStatus = resolveFeatureStatus(state);
    const catalog = input.catalog ?? (await readCatalog(resolved.worktree));
    return {
      ...base,
      acceptedFeatureIds: resolvedStatus.acceptedFeatureIds,
      statuses: Object.fromEntries([...resolvedStatus.statuses.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'))),
      notes: catalogProvenanceNotes(resolvedStatus, catalogDigestOf(catalog)),
    };
  } finally {
    await ledger.close();
  }
}

/**
 * Composes the exact seed request the owner's approval must match, and prints it
 * for owner authoring. The controller composes the request; it never supplies
 * the authorization.
 */
export async function printSeedRequest(input: {
  config: ActivationConfig;
  repository: RepositoryObservation;
  createdAt: string;
  approvalId: string;
  clock?: { now(): string };
  catalog?: unknown;
}): Promise<{
  request: unknown;
  requestDigest: string;
  catalogDigest: string;
  targetGeneration: number;
  ceremonies: readonly LedgerCeremony[];
}> {
  const resolved = await resolveActivation(input.config);
  const catalog = input.catalog ?? (await readCatalog(resolved.worktree));
  const request = buildSeedRequest({
    pairs: catalogStatusPairs(catalog),
    repository: input.repository,
    createdAt: input.createdAt,
    approvalId: input.approvalId,
  });
  // EL-REQ-BOOT-002 requires the controller to author the request in full on the
  // developer's behalf, the target generation included. Read lock-free: composing
  // a request is inspection, and taking the writer lock here would make the
  // command unusable exactly when a seed is in flight.
  const ledger = await AcceptanceLedger.openReadOnly({
    ledgerRoot: resolved.ledgerRoot,
    worktree: resolved.worktree,
    clock: input.clock ?? { now: () => new Date().toISOString() },
  });
  const state = await ledger.readCurrentGeneration();
  return {
    request,
    requestDigest: protectedRequestDigest(request),
    catalogDigest: catalogDigestOf(catalog),
    targetGeneration: state.generation,
    ceremonies: admissibleLedgerCeremonies(state),
  };
}

/**
 * Composes the exact steady-state acceptance request and prints its digest for
 * the owner to author approval material against.
 *
 * This is the reachable producer `EL-REQ-APPROVAL-010` requires. The owner cannot
 * hand-compute a request digest — it is sha256 over the canonical form of the
 * whole request material — so a protected action whose authorizing material has
 * no reachable producer is an authorization path nobody can walk. EL-10 shipped
 * exactly that and it was caught by inspection rather than by a gate; the
 * requirement and its static check exist so the next one fails loudly.
 *
 * It reads no approval and touches no channel (`EL-REQ-APPROVAL-012`): every
 * unprotected preparatory step completes before any approval exists.
 */
export async function printAcceptanceChangeRequest(input: {
  config: ActivationConfig;
  pairs: readonly CatalogStatusPair[];
  repository: RepositoryObservation;
  createdAt: string;
  approvalId: string;
  clock?: { now(): string };
}): Promise<{
  request: unknown;
  requestDigest: string;
  catalogDigest: string;
  targetGeneration: number;
  ceremonies: readonly LedgerCeremony[];
}> {
  const resolved = await resolveActivation(input.config);
  const catalog = await readCatalog(resolved.worktree);
  const request = buildAcceptanceChangeRequest({
    pairs: input.pairs,
    repository: input.repository,
    createdAt: input.createdAt,
    approvalId: input.approvalId,
  });
  const ledger = await AcceptanceLedger.openReadOnly({
    ledgerRoot: resolved.ledgerRoot,
    worktree: resolved.worktree,
    clock: input.clock ?? { now: () => new Date().toISOString() },
  });
  try {
    const state = await ledger.readCurrentGeneration();
    return {
      request,
      requestDigest: protectedRequestDigest(request),
      catalogDigest: catalogDigestOf(catalog),
      targetGeneration: state.generation,
      ceremonies: admissibleLedgerCeremonies(state),
    };
  } finally {
    await ledger.close();
  }
}

export interface AcceptanceChangeRunInput {
  config: ActivationConfig;
  clock: { now(): string };
  ownerId: string;
  ownerToken: string;
  pairs: readonly CatalogStatusPair[];
  repository: RepositoryObservation;
  createdAt: string;
  approvalId: string;
  catalog?: unknown;
}

/**
 * Executes a steady-state acceptance change against owner-authored approval
 * material (`EL-REQ-BOOT-008`). The controller composes and transports; the
 * channel is the only source of authorization.
 */
export async function runAcceptanceChange(input: AcceptanceChangeRunInput) {
  const resolved = await resolveActivation(input.config);
  const catalog = input.catalog ?? (await readCatalog(resolved.worktree));
  const channel = await FileProtectedApprovalChannel.open({
    channelDirectory: resolved.approvalChannel,
    worktree: resolved.worktree,
  });
  const ledger = await AcceptanceLedger.open({
    ledgerRoot: resolved.ledgerRoot,
    worktree: resolved.worktree,
    clock: input.clock,
    ownerId: input.ownerId,
    ownerToken: input.ownerToken,
  });
  try {
    return await recordAcceptanceChange({
      ledger,
      channel,
      catalog,
      pairs: input.pairs,
      repository: input.repository,
      now: input.clock.now(),
      createdAt: input.createdAt,
      approvalId: input.approvalId,
    });
  } finally {
    await ledger.close();
  }
}

export interface ActivationSeedInput {
  config: ActivationConfig;
  clock: { now(): string };
  ownerId: string;
  ownerToken: string;
  repository: RepositoryObservation;
  createdAt: string;
  approvalId: string;
  catalog?: unknown;
}

export async function runActivationSeed(input: ActivationSeedInput) {
  const resolved = await resolveActivation(input.config);
  const catalog = input.catalog ?? (await readCatalog(resolved.worktree));
  const channel = await FileProtectedApprovalChannel.open({
    channelDirectory: resolved.approvalChannel,
    worktree: resolved.worktree,
  });
  const ledger = await AcceptanceLedger.open({
    ledgerRoot: resolved.ledgerRoot,
    worktree: resolved.worktree,
    clock: input.clock,
    ownerId: input.ownerId,
    ownerToken: input.ownerToken,
  });
  try {
    return await seedAcceptanceLedger({
      ledger,
      channel,
      catalog,
      repository: input.repository,
      now: input.clock.now(),
      createdAt: input.createdAt,
      approvalId: input.approvalId,
    });
  } finally {
    await ledger.close();
  }
}

/**
 * Composes the exact `ledger_recovery` content-reconciliation request and prints
 * its digest for the owner to author approval material against.
 *
 * This is `EL-REQ-BOOT-006`'s reachable producer (`EL-REQ-APPROVAL-010`): before
 * this command existed, `buildLedgerRecoveryRequest` had no caller outside
 * `tests/`, so an owner facing content corruption could not obtain the digest
 * their approval must match — an authorization path nobody could walk. It reads
 * no approval and touches no channel (`EL-REQ-APPROVAL-012`); the owner-supplied
 * reconciliation material (issuer, signature, evidence, reason) enters the
 * reconciliation record at execution, not the request digest, so composition
 * needs none of it.
 */
export async function printRecoveryRequest(input: {
  config: ActivationConfig;
  scope: readonly ReconciliationScopeItem[];
  repository: RepositoryObservation;
  createdAt: string;
  approvalId: string;
  clock?: { now(): string };
  catalog?: unknown;
}): Promise<{
  request: unknown;
  requestDigest: string;
  catalogDigest: string;
  targetGeneration: number;
  ceremonies: readonly LedgerCeremony[];
}> {
  const resolved = await resolveActivation(input.config);
  const catalog = input.catalog ?? (await readCatalog(resolved.worktree));
  const request = buildLedgerRecoveryRequest({
    scope: input.scope,
    repository: input.repository,
    createdAt: input.createdAt,
    approvalId: input.approvalId,
  });
  const ledger = await AcceptanceLedger.openReadOnly({
    ledgerRoot: resolved.ledgerRoot,
    worktree: resolved.worktree,
    clock: input.clock ?? { now: () => new Date().toISOString() },
  });
  try {
    const state = await ledger.readCurrentGeneration();
    return {
      request,
      requestDigest: protectedRequestDigest(request),
      catalogDigest: catalogDigestOf(catalog),
      targetGeneration: state.generation,
      ceremonies: admissibleLedgerCeremonies(state),
    };
  } finally {
    await ledger.close();
  }
}

export interface LedgerRecoveryRunInput {
  config: ActivationConfig;
  clock: { now(): string };
  ownerId: string;
  ownerToken: string;
  scope: readonly ReconciliationScopeItem[];
  issuer: string;
  signatureReference: string;
  evidenceReference: string;
  evidenceDigest: string;
  reason: string;
  repository: RepositoryObservation;
  createdAt: string;
  approvalId: string;
  catalog?: unknown;
}

/**
 * Executes an owner-approved content reconciliation (`EL-REQ-BOOT-006`) against
 * owner-authored channel material. The controller composes and transports; the
 * channel is the only source of authorization, and the ceremony's own predicate
 * — a non-empty generation whose chain validates — is re-derived inside
 * `recoverLedgerContent` on every attempt.
 */
export async function runLedgerRecovery(input: LedgerRecoveryRunInput) {
  const resolved = await resolveActivation(input.config);
  const catalog = input.catalog ?? (await readCatalog(resolved.worktree));
  const channel = await FileProtectedApprovalChannel.open({
    channelDirectory: resolved.approvalChannel,
    worktree: resolved.worktree,
  });
  const ledger = await AcceptanceLedger.open({
    ledgerRoot: resolved.ledgerRoot,
    worktree: resolved.worktree,
    clock: input.clock,
    ownerId: input.ownerId,
    ownerToken: input.ownerToken,
  });
  try {
    return await recoverLedgerContent({
      ledger,
      channel,
      catalog,
      repository: input.repository,
      scope: input.scope,
      issuer: input.issuer,
      signatureReference: input.signatureReference,
      evidenceReference: input.evidenceReference,
      evidenceDigest: input.evidenceDigest,
      reason: input.reason,
      now: input.clock.now(),
      createdAt: input.createdAt,
      approvalId: input.approvalId,
    });
  } finally {
    await ledger.close();
  }
}

/**
 * Composes the two re-genesis requests and prints both digests
 * (`EL-REQ-BOOT-007`'s reachable producer).
 *
 * Two requests because re-genesis is two owner decisions: the genesis request
 * (`ledger_recovery`) authorizes opening a new generation naming the observed
 * break, and the seed request (`acceptance_change`) authorizes the
 * reconstruction pairs. One approval record cannot cover both —
 * `authorizeProtectedAction` matches action and request digest exactly and the
 * two requests differ in both — so the owner authors two records and the
 * composition refuses when a chain is intact, because there is no break for a
 * genesis request to name truthfully.
 */
export async function printGenesisRequest(input: {
  config: ActivationConfig;
  pairs: readonly CatalogStatusPair[];
  repository: RepositoryObservation;
  createdAt: string;
  genesisApprovalId: string;
  seedApprovalId: string;
  clock?: { now(): string };
  catalog?: unknown;
}): Promise<{
  genesisRequest: unknown;
  genesisRequestDigest: string;
  seedRequest: unknown;
  seedRequestDigest: string;
  catalogDigest: string;
  corruptGeneration: number;
  targetGeneration: number;
  breach: unknown;
  ceremonies: readonly LedgerCeremony[];
}> {
  const resolved = await resolveActivation(input.config);
  const catalog = input.catalog ?? (await readCatalog(resolved.worktree));
  const ledger = await AcceptanceLedger.openReadOnly({
    ledgerRoot: resolved.ledgerRoot,
    worktree: resolved.worktree,
    clock: input.clock ?? { now: () => new Date().toISOString() },
  });
  try {
    const state = await ledger.readCurrentGeneration();
    if (state.integrity !== 'broken' || state.breach === null) {
      throw new LedgerRecoveryRefusedError(
        `Generation ${state.generation} has an intact integrity chain; there is no break for a genesis request to name, and re-genesis is refused. ${
          state.records.length === 0
            ? 'The generation is empty, so seeding under EL-REQ-BOOT-003 applies.'
            : 'A status change is recorded by steady_state_acceptance under EL-REQ-BOOT-008, and content corruption on a validating chain is corrected by ledger_recovery under EL-REQ-BOOT-006.'
        }`
      );
    }
    const corruptGeneration = state.generation;
    const targetGeneration = corruptGeneration + 1;
    const genesisRequest = buildGenesisRequest({
      corruptGeneration,
      newGeneration: targetGeneration,
      breach: state.breach,
      repository: input.repository,
      createdAt: input.createdAt,
      approvalId: input.genesisApprovalId,
    });
    // The same canonical order `reGenesisLedger` applies, so the digest printed
    // here and the request composed at execution cannot disagree over flag order.
    const seedRequest = buildSeedRequest({
      pairs: canonicalStatusPairs(input.pairs),
      repository: input.repository,
      createdAt: input.createdAt,
      approvalId: input.seedApprovalId,
    });
    return {
      genesisRequest,
      genesisRequestDigest: protectedRequestDigest(genesisRequest),
      seedRequest,
      seedRequestDigest: protectedRequestDigest(seedRequest),
      catalogDigest: catalogDigestOf(catalog),
      corruptGeneration,
      targetGeneration,
      breach: state.breach,
      ceremonies: admissibleLedgerCeremonies(state),
    };
  } finally {
    await ledger.close();
  }
}

export interface ReGenesisRunInput {
  config: ActivationConfig;
  clock: { now(): string };
  ownerId: string;
  ownerToken: string;
  pairs: readonly CatalogStatusPair[];
  issuer: string;
  signatureReference: string;
  reconstructionBasis: string;
  repository: RepositoryObservation;
  createdAt: string;
  genesisApprovalId: string;
  seedApprovalId: string;
  catalog?: unknown;
}

/**
 * Executes an owner-approved re-genesis (`EL-REQ-BOOT-007`): a new generation
 * under the seeding gate, opened by a signed genesis record naming the break,
 * with the corrupt generation retained read-only. The broken-chain predicate is
 * re-derived inside `reGenesisLedger`; a healthy generation refuses.
 */
export async function runReGenesis(input: ReGenesisRunInput) {
  const resolved = await resolveActivation(input.config);
  const catalog = input.catalog ?? (await readCatalog(resolved.worktree));
  const channel = await FileProtectedApprovalChannel.open({
    channelDirectory: resolved.approvalChannel,
    worktree: resolved.worktree,
  });
  const ledger = await AcceptanceLedger.open({
    ledgerRoot: resolved.ledgerRoot,
    worktree: resolved.worktree,
    clock: input.clock,
    ownerId: input.ownerId,
    ownerToken: input.ownerToken,
  });
  try {
    return await reGenesisLedger({
      ledger,
      channel,
      catalog,
      repository: input.repository,
      issuer: input.issuer,
      signatureReference: input.signatureReference,
      reconstructionBasis: input.reconstructionBasis,
      now: input.clock.now(),
      createdAt: input.createdAt,
      genesisApprovalId: input.genesisApprovalId,
      seedApprovalId: input.seedApprovalId,
      pairs: input.pairs,
    });
  } finally {
    await ledger.close();
  }
}

/**
 * The recommended locations are documentation, never a code default.
 *
 * EL-REQ-BOOT-001 requires the entrypoint to resolve every location from
 * explicit configuration and to refuse to start when any is absent. A built-in
 * fallback would satisfy the letter of "resolves" while destroying the point:
 * the controller would silently start against a path nobody chose, which is the
 * implicit-magic failure this feature exists to remove. So the convention is
 * printed here for an operator to copy, and unset configuration still refuses.
 *
 * These deliberately avoid the per-user application-data directories
 * (`%LOCALAPPDATA%`, `~/Library`, `$XDG_STATE_HOME`). A containerized host —
 * MSIX on Windows, Flatpak or Snap on Linux, the macOS app sandbox — silently
 * redirects writes there into a per-package cache. The ledger would then live
 * inside one application's private storage, vanish if that application is reset,
 * and, worst of all, resolve to a *different* directory for an operator running
 * the same command from an uncontainerized shell: the owner would issue approval
 * into a channel the controller never reads, and each would see a coherent,
 * empty, disagreeing view. `resolveActivation` reports any such redirect.
 */
export const RECOMMENDED_PROTECTED_LOCATIONS = {
  win32: '<drive>:\\trellis-protected\\engineering-loop\\{ledger,state,channel}',
  posix: '$HOME/trellis-protected/engineering-loop/{ledger,state,channel}',
} as const;

const USAGE = `Trellis engineering-loop controller activation (${ACTIVATION_VERSION})

Usage:
  npm run el:activate -- <command>
  tsx tools/engineering-loop/src/activate.ts <command>

Commands:
  check                     Resolve and validate every configured protected location.
  status                    Report ledger generation, admissible ceremonies, and
                            resolved status.
  print-seed-request        Compose the exact seed request and print its digest,
                            for the owner to author approval material against.
  seed                      Execute seeding against owner-authored approval
                            material. Seeding applies to an empty generation only.
  print-acceptance-request  Compose the exact steady-state acceptance-change
                            request and print its digest, for the owner to author
                            approval material against.
  record-acceptance         Execute a steady-state acceptance change against
                            owner-authored approval material. This is how a
                            feature becomes accepted or unblocked once the ledger
                            holds history.
  print-recovery-request    Compose the exact ledger_recovery content-
                            reconciliation request and print its digest, for the
                            owner to author approval material against.
  recover                   Execute an owner-approved content reconciliation
                            against a populated generation whose chain validates.
                            Superseded records are marked by replay, never
                            mutated; an empty generation and a broken chain each
                            refuse toward their own ceremony.
  print-genesis-request     Compose the two re-genesis requests — the signed
                            genesis record's ledger_recovery request and the new
                            generation's acceptance_change seed request — and
                            print both digests. Requires an observed broken
                            chain; an intact chain has no break to name.
  re-genesis                Execute an owner-approved re-genesis: open a new
                            generation under the seeding gate with a signed
                            genesis record naming the break, retaining the
                            corrupt generation read-only as history.

Seeding arguments (print-seed-request, seed):
  --branch <name>      Expected branch; the observer refuses a mismatch.
  --base <sha>         Expected base commit; must be an ancestor of HEAD.
  --remote-name <name> Git remote name, e.g. origin.
  --remote-url <url>   Expected remote identity; the observer refuses a mismatch.
  --approval-id <id>   The approval identity to read from the protected channel.
  --created-at <iso>   Request timestamp. Required for seed; carry the exact
                       value print-seed-request emitted, because the request
                       digest covers it and a new timestamp invalidates the
                       owner's approval.

Acceptance-change arguments (print-acceptance-request, record-acceptance):
  every seeding argument above, plus
  --set <id>=<status>  Repeatable. One exact (feature, status) pair, for example
                       --set EL-10=accepted --set EL-07=planned. Status is one of
                       planned, active, accepted, blocked, deferred. At least one
                       is required: the controller never infers a status change.

Recovery arguments (print-recovery-request, recover):
  every seeding argument above, plus
  --supersede <id>=<status>:<seq[,seq...]>
                       Repeatable. One reconciliation item: the feature, its
                       corrected status, and the exact superseded sequence(s),
                       for example --supersede EL-07=planned:2. At least one is
                       required: the controller never infers a correction.
  and, for recover only (owner-supplied reconciliation material):
  --issuer <id>            The reconciling authority.
  --signature-ref <ref>    Reference to the owner's signature artifact.
  --evidence-ref <ref>     Reference to the corruption evidence.
  --evidence-digest <sha>  sha256 digest of the corruption evidence.
  --reason <text>          Why the superseded records are wrong.

Re-genesis arguments (print-genesis-request, re-genesis):
  --branch, --base, --remote-name, --remote-url, --created-at as above, plus
  --genesis-approval-id <id>  Approval identity for the genesis ledger_recovery
                              request.
  --seed-approval-id <id>     Approval identity for the reconstruction's
                              acceptance_change seed request. Two distinct owner
                              decisions; one approval identity cannot cover both.
  --set <id>=<status>  Repeatable. One reconstruction (feature, status) pair from
                       the owner's reconstruction basis, never from
                       controller-held state.
  and, for re-genesis only (owner-supplied genesis material):
  --issuer <id>                  The reconstructing authority.
  --signature-ref <ref>          Reference to the owner's signature artifact.
  --reconstruction-basis <text>  What the reconstruction derives from.

Required environment (no defaults; absent configuration refuses to start):
  ${ACTIVATION_ENVIRONMENT_KEYS.ledgerRoot}        Acceptance-ledger protected root
  ${ACTIVATION_ENVIRONMENT_KEYS.stateRoot}         Workflow state protected root
  ${ACTIVATION_ENVIRONMENT_KEYS.worktree}           Assigned worktree
  ${ACTIVATION_ENVIRONMENT_KEYS.approvalChannel}   Protected external approval channel directory

Recommended locations (a convention to copy, not a fallback the code applies):
  Windows   ${RECOMMENDED_PROTECTED_LOCATIONS.win32}
  POSIX     ${RECOMMENDED_PROTECTED_LOCATIONS.posix}

Do not place a protected root under a per-user application-data directory
(%LOCALAPPDATA%, ~/Library, \$XDG_STATE_HOME). A containerized host silently
redirects writes there into a private package cache, so the same configuration
names a different directory for a contained process than for your shell: you
would issue approval into a channel the controller never reads, and both sides
would see a coherent, empty, disagreeing ledger. 'check' reports any redirect it
observes under 'redirects'; compare it against what you configured.

Every root must sit outside every worktree. A root inside, aliasing into, or
reachable by symbolic link from the assigned worktree is refused, because an
agent that can write the worktree could otherwise forge its own acceptance.

The controller composes the request; it never supplies the authorization. Every
write reads owner-authored approval material from the protected channel and
refuses without it. There is no flag, environment variable, or configuration
that substitutes for that material.

Which write applies is re-derived from the ledger every run, never from a flag:
an empty generation admits seeding, a populated validating generation admits a
steady-state acceptance change (record-acceptance) and content reconciliation,
and a broken chain admits only out-of-band re-genesis. 'status' reports the set
under 'ceremonies'.
`;

/**
 * The process entrypoint. This module is executable directly and via the
 * `el:activate` npm script; both are real non-test callers.
 */
export async function main(argv: readonly string[], environment: Record<string, string | undefined>): Promise<number> {
  const command = argv[0] ?? 'check';
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  const known = [
    'check',
    'status',
    'print-seed-request',
    'seed',
    'print-acceptance-request',
    'record-acceptance',
    'print-recovery-request',
    'recover',
    'print-genesis-request',
    're-genesis',
  ];
  if (!known.includes(command)) {
    process.stderr.write(`Unknown command '${command}'.\n\n${USAGE}`);
    return 2;
  }
  try {
    const config = readActivationConfig(environment);
    const clock = { now: () => new Date().toISOString() };
    const ownerId = environment.USER ?? environment.USERNAME ?? 'operator';

    if (command === 'print-acceptance-request' || command === 'record-acceptance') {
      const args = parseAcceptanceChangeArguments(
        argv.slice(1),
        command === 'print-acceptance-request' ? { createdAt: clock.now() } : {}
      );
      const resolved = await resolveActivation(config);
      const catalog = await readCatalog(resolved.worktree);
      const { observation, commandCount } = await observeSeedRepository({
        resolved,
        args,
        clock,
        observationId: 'repository-observation:el11-acceptance-change',
        featureId: ACCEPTANCE_CHANGE_FEATURE_ID,
        sessionId: ACCEPTANCE_CHANGE_SESSION_ID,
      });

      if (command === 'print-acceptance-request') {
        const printed = await printAcceptanceChangeRequest({
          config,
          pairs: args.pairs,
          repository: observation,
          createdAt: args.createdAt,
          approvalId: args.approvalId,
          clock,
        });
        process.stdout.write(`${canonicalJson({
          version: ACTIVATION_VERSION,
          result: 'acceptance_change_request_composed',
          note: 'Author approval material matching requestDigest and repositoryPrecondition exactly, place it in the protected channel, then run record-acceptance with the identical --created-at and --set arguments.',
          createdAt: args.createdAt,
          requestDigest: printed.requestDigest,
          catalogDigest: printed.catalogDigest,
          targetGeneration: printed.targetGeneration,
          ceremonies: printed.ceremonies,
          repositoryObservationCommands: commandCount,
          request: printed.request,
        })}\n`);
        return 0;
      }

      const result = await runAcceptanceChange({
        config,
        clock,
        ownerId,
        ownerToken: `acceptance-change-${process.pid}-${Date.now()}`,
        pairs: args.pairs,
        repository: observation,
        createdAt: args.createdAt,
        approvalId: args.approvalId,
        catalog,
      });
      process.stdout.write(`${canonicalJson({
        version: ACTIVATION_VERSION,
        result: 'acceptance_recorded',
        generation: result.generation,
        appendedRecordCount: result.appended.length,
        generationRecordCount: result.records.length,
        approvalId: result.approvalId,
        consumptionId: result.consumptionId,
        requestDigest: result.requestDigest,
        scope: result.scope,
      })}\n`);
      return 0;
    }

    if (command === 'print-recovery-request' || command === 'recover') {
      const args = parseRecoveryArguments(
        argv.slice(1),
        command === 'print-recovery-request' ? { createdAt: clock.now() } : {}
      );
      const resolved = await resolveActivation(config);
      const catalog = await readCatalog(resolved.worktree);
      const { observation, commandCount } = await observeSeedRepository({
        resolved,
        args,
        clock,
        observationId: 'repository-observation:el10-ledger-recovery',
      });

      if (command === 'print-recovery-request') {
        const printed = await printRecoveryRequest({
          config,
          scope: args.scope,
          repository: observation,
          createdAt: args.createdAt,
          approvalId: args.approvalId,
          clock,
          catalog,
        });
        process.stdout.write(`${canonicalJson({
          version: ACTIVATION_VERSION,
          result: 'ledger_recovery_request_composed',
          note: 'Author approval material matching requestDigest and repositoryPrecondition exactly, place it in the protected channel, then run recover with the identical --created-at and --supersede arguments plus --issuer, --signature-ref, --evidence-ref, --evidence-digest, and --reason.',
          createdAt: args.createdAt,
          requestDigest: printed.requestDigest,
          catalogDigest: printed.catalogDigest,
          targetGeneration: printed.targetGeneration,
          ceremonies: printed.ceremonies,
          repositoryObservationCommands: commandCount,
          request: printed.request,
        })}\n`);
        return 0;
      }

      const missingRecoveryFlags = ([
        ['--issuer', args.issuer],
        ['--signature-ref', args.signatureReference],
        ['--evidence-ref', args.evidenceReference],
        ['--evidence-digest', args.evidenceDigest],
        ['--reason', args.reason],
      ] as const).filter(([, value]) => value === undefined).map(([flag]) => flag);
      if (missingRecoveryFlags.length > 0) {
        throw new ActivationConfigError(
          `recover requires the owner-supplied ${missingRecoveryFlags.join(', ')}`
        );
      }
      const result = await runLedgerRecovery({
        config,
        clock,
        ownerId,
        ownerToken: `ledger-recovery-${process.pid}-${Date.now()}`,
        scope: args.scope,
        issuer: args.issuer as string,
        signatureReference: args.signatureReference as string,
        evidenceReference: args.evidenceReference as string,
        evidenceDigest: args.evidenceDigest as string,
        reason: args.reason as string,
        repository: observation,
        createdAt: args.createdAt,
        approvalId: args.approvalId,
        catalog,
      });
      process.stdout.write(`${canonicalJson({
        version: ACTIVATION_VERSION,
        result: 'ledger_recovered',
        generation: result.generation,
        appendedRecordCount: args.scope.length,
        generationRecordCount: result.records.length,
        reconciliationId: result.reconciliation.id,
        approvalId: result.approvalId,
        consumptionId: result.consumptionId,
      })}\n`);
      return 0;
    }

    if (command === 'print-genesis-request' || command === 're-genesis') {
      const args = parseGenesisArguments(
        argv.slice(1),
        command === 'print-genesis-request' ? { createdAt: clock.now() } : {}
      );
      const resolved = await resolveActivation(config);
      const catalog = await readCatalog(resolved.worktree);
      const { observation, commandCount } = await observeSeedRepository({
        resolved,
        args,
        clock,
        observationId: 'repository-observation:el10-re-genesis',
      });

      if (command === 'print-genesis-request') {
        const printed = await printGenesisRequest({
          config,
          pairs: args.pairs,
          repository: observation,
          createdAt: args.createdAt,
          genesisApprovalId: args.genesisApprovalId,
          seedApprovalId: args.seedApprovalId,
          clock,
          catalog,
        });
        process.stdout.write(`${canonicalJson({
          version: ACTIVATION_VERSION,
          result: 're_genesis_requests_composed',
          note: 'Author two approval records — one matching genesisRequestDigest, one matching seedRequestDigest — place both in the protected channel, then run re-genesis with the identical --created-at and --set arguments plus --issuer, --signature-ref, and --reconstruction-basis.',
          createdAt: args.createdAt,
          genesisRequestDigest: printed.genesisRequestDigest,
          seedRequestDigest: printed.seedRequestDigest,
          catalogDigest: printed.catalogDigest,
          corruptGeneration: printed.corruptGeneration,
          targetGeneration: printed.targetGeneration,
          breach: printed.breach,
          ceremonies: printed.ceremonies,
          repositoryObservationCommands: commandCount,
          genesisRequest: printed.genesisRequest,
          seedRequest: printed.seedRequest,
        })}\n`);
        return 0;
      }

      const missingGenesisFlags = ([
        ['--issuer', args.issuer],
        ['--signature-ref', args.signatureReference],
        ['--reconstruction-basis', args.reconstructionBasis],
      ] as const).filter(([, value]) => value === undefined).map(([flag]) => flag);
      if (missingGenesisFlags.length > 0) {
        throw new ActivationConfigError(
          `re-genesis requires the owner-supplied ${missingGenesisFlags.join(', ')}`
        );
      }
      const result = await runReGenesis({
        config,
        clock,
        ownerId,
        ownerToken: `re-genesis-${process.pid}-${Date.now()}`,
        pairs: args.pairs,
        issuer: args.issuer as string,
        signatureReference: args.signatureReference as string,
        reconstructionBasis: args.reconstructionBasis as string,
        repository: observation,
        createdAt: args.createdAt,
        genesisApprovalId: args.genesisApprovalId,
        seedApprovalId: args.seedApprovalId,
        catalog,
      });
      process.stdout.write(`${canonicalJson({
        version: ACTIVATION_VERSION,
        result: 're_genesis_completed',
        corruptGeneration: result.corruptGeneration,
        newGeneration: result.newGeneration,
        breakReason: result.breach.reason,
        genesisRecordId: result.genesis.id,
        generationRecordCount: result.seed.records.length,
        genesisApprovalId: args.genesisApprovalId,
        seedApprovalId: args.seedApprovalId,
        seedConsumptionId: result.seed.consumptionId,
      })}\n`);
      return 0;
    }

    if (command === 'print-seed-request' || command === 'seed') {
      const args = parseSeedArguments(
        argv.slice(1),
        command === 'print-seed-request' ? { createdAt: clock.now() } : {}
      );
      const resolved = await resolveActivation(config);
      const catalog = await readCatalog(resolved.worktree);
      const { observation, commandCount } = await observeSeedRepository({ resolved, args, clock });

      // Both branches run the same composition the suite pins (`printSeedRequest`
      // and `runActivationSeed`) rather than an inlined twin of it. The twins
      // had already drifted apart in reach — the tests pinned functions no
      // operator ran — which is this feature's defect class in miniature.
      if (command === 'print-seed-request') {
        const printed = await printSeedRequest({
          config,
          repository: observation,
          createdAt: args.createdAt,
          approvalId: args.approvalId,
          clock,
          catalog,
        });
        process.stdout.write(`${canonicalJson({
          version: ACTIVATION_VERSION,
          result: 'seed_request_composed',
          note: 'Author approval material matching requestDigest and repositoryPrecondition exactly, place it in the protected channel, then run seed with the identical --created-at.',
          createdAt: args.createdAt,
          requestDigest: printed.requestDigest,
          catalogDigest: printed.catalogDigest,
          targetGeneration: printed.targetGeneration,
          ceremonies: printed.ceremonies,
          repositoryObservationCommands: commandCount,
          request: printed.request,
        })}\n`);
        return 0;
      }

      const result = await runActivationSeed({
        config,
        clock,
        ownerId,
        ownerToken: `activation-${process.pid}-${Date.now()}`,
        repository: observation,
        createdAt: args.createdAt,
        approvalId: args.approvalId,
        catalog,
      });
      process.stdout.write(`${canonicalJson({
        version: ACTIVATION_VERSION,
        result: 'seeded',
        generation: result.generation,
        recordCount: result.records.length,
        approvalId: result.approvalId,
        consumptionId: result.consumptionId,
        requestDigest: result.requestDigest,
        scope: result.scope,
      })}\n`);
      return 0;
    }

    if (command === 'check') {
      const resolved = await resolveActivation(config);
      process.stdout.write(`${canonicalJson({
        version: ACTIVATION_VERSION,
        result: 'resolved',
        ledgerRoot: resolved.ledgerRoot,
        stateRoot: resolved.stateRoot,
        worktree: resolved.worktree,
        approvalChannel: resolved.approvalChannel,
        redirects: resolved.redirects,
      })}\n`);
      return 0;
    }
    const status = await inspectActivation({ config, clock });
    process.stdout.write(`${canonicalJson(status)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${canonicalJson({
      version: ACTIVATION_VERSION,
      result: 'refused',
      error: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    })}\n`);
    return 1;
  }
}

/**
 * True when this module is the process entrypoint rather than an import.
 *
 * The build emits CommonJS, so `import.meta` is unavailable, and `require.main`
 * is absent under the ESM-transforming test runner. Comparing the invoked
 * script's basename works under both and is a pure function the suite pins
 * directly, rather than a condition that can only be observed by launching a
 * process. `win32.basename` splits on both separator families, so a
 * Windows-style argv[1] resolves identically on a POSIX host.
 */
export function invokedAsEntrypoint(argv1: string | undefined): boolean {
  if (argv1 === undefined || argv1.length === 0) return false;
  const base = win32.basename(argv1);
  return base === 'activate.ts' || base === 'activate.js';
}

if (invokedAsEntrypoint(process.argv[1])) {
  main(process.argv.slice(2), process.env)
    .then(code => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
