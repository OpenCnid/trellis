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
  recordAcceptanceChange,
} from './acceptance_change.js';
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
export const SeedArgumentsSchema = z.strictObject({
  branch: z.string().min(1).max(256),
  baseCommit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, 'must be a full Git commit identity'),
  remoteName: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  remoteUrl: z.string().min(1).max(2_048),
  approvalId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'must be a stable identifier'),
  createdAt: z.string().datetime({ offset: true }),
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
  args: SeedArguments;
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
  const known = ['check', 'status', 'print-seed-request', 'seed', 'print-acceptance-request', 'record-acceptance'];
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

    if (command === 'print-seed-request' || command === 'seed') {
      const args = parseSeedArguments(
        argv.slice(1),
        command === 'print-seed-request' ? { createdAt: clock.now() } : {}
      );
      const resolved = await resolveActivation(config);
      const catalog = await readCatalog(resolved.worktree);
      const { observation, commandCount } = await observeSeedRepository({ resolved, args, clock });
      const request = buildSeedRequest({
        pairs: catalogStatusPairs(catalog),
        repository: observation,
        createdAt: args.createdAt,
        approvalId: args.approvalId,
      });
      const requestDigest = protectedRequestDigest(request);

      if (command === 'print-seed-request') {
        const readOnly = await AcceptanceLedger.openReadOnly({
          ledgerRoot: resolved.ledgerRoot,
          worktree: resolved.worktree,
          clock,
        });
        const state = await readOnly.readCurrentGeneration();
        process.stdout.write(`${canonicalJson({
          version: ACTIVATION_VERSION,
          result: 'seed_request_composed',
          note: 'Author approval material matching requestDigest and repositoryPrecondition exactly, place it in the protected channel, then run seed with the identical --created-at.',
          createdAt: args.createdAt,
          requestDigest,
          catalogDigest: catalogDigestOf(catalog),
          targetGeneration: state.generation,
          ceremonies: admissibleLedgerCeremonies(state),
          repositoryObservationCommands: commandCount,
          request,
        })}\n`);
        return 0;
      }

      const channel = await FileProtectedApprovalChannel.open({
        channelDirectory: resolved.approvalChannel,
        worktree: resolved.worktree,
      });
      const ledger = await AcceptanceLedger.open({
        ledgerRoot: resolved.ledgerRoot,
        worktree: resolved.worktree,
        clock,
        ownerId,
        ownerToken: `activation-${process.pid}-${Date.now()}`,
      });
      try {
        const result = await seedAcceptanceLedger({
          ledger,
          channel,
          catalog,
          repository: observation,
          now: clock.now(),
          createdAt: args.createdAt,
          approvalId: args.approvalId,
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
      } finally {
        await ledger.close();
      }
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
