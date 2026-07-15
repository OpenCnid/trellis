import { mkdir, open, readFile, readdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  DOMAIN_SCHEMA_VERSION,
  GENESIS_DIGEST,
  StableIdSchema,
  parseBoundary,
} from './domain.js';
import { canonicalJson, sha256Canonical } from './events.js';
import { validateProtectedStateRoot } from './state_store.js';
import { WriterLock } from './writer_lock.js';
import type { Clock } from './state_store.js';

/**
 * The program-scoped acceptance ledger (SPEC 6.1, EL-REQ-BOOT-002 through
 * EL-REQ-BOOT-007).
 *
 * Feature status is program-scoped; workflow state is feature-scoped. A
 * `StateSnapshot` names one feature in one state root and cannot express which
 * features the owner accepted, so acceptance lives here instead — in its own
 * protected root, append-only and integrity-linked, never derived from a
 * workflow snapshot the controller produced itself.
 */

export const ACCEPTANCE_LEDGER_VERSION = 'trellis-acceptance-ledger:v1' as const;
export const PROGRAM_ACCEPTANCE_WORKFLOW_ID = 'workflow:program-acceptance';
export const LEDGER_GENERATIONS_DIRECTORY = 'generations';
export const LEDGER_CURRENT_FILE = 'current';
export const LEDGER_RECORD_FILE = 'acceptance.jsonl';

export const MAX_LEDGER_RECORDS = 1_024;
export const MAX_LEDGER_RECORD_BYTES = 8 * 1_024;
export const MAX_LEDGER_BYTES = MAX_LEDGER_RECORDS * MAX_LEDGER_RECORD_BYTES;
export const MAX_LEDGER_GENERATIONS = 64;
export const MAX_SUPERSEDED_SEQUENCES = 64;

const TimestampSchema = z.string().datetime({ offset: true });
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase sha256 digest');

function boundedText(maxBytes: number) {
  return z.string().min(1).refine(
    value => Buffer.byteLength(value, 'utf8') <= maxBytes,
    `must not exceed ${maxBytes} UTF-8 bytes`
  );
}

const BoundedReasonSchema = boundedText(1_024);

/**
 * Mirrors the catalog's existing `bootstrapStatus` enum. Migration moves a
 * value between artifacts; it never redefines one.
 */
export const FeatureStatusSchema = z.enum(['planned', 'active', 'accepted', 'blocked', 'deferred']);
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;

/** The four integrity breaches of EL-REQ-BOOT-005. */
export const LEDGER_BREACH_REASONS = [
  'missing_sequence',
  'digest_mismatch',
  'invalid_schema',
  'partial_append',
] as const;
export type LedgerBreachReason = (typeof LEDGER_BREACH_REASONS)[number];

/**
 * Every ledger record carries this envelope. `actor` is pinned to `human`: no
 * other authority can produce a ledger record, which is the schema-level
 * statement of "the controller cannot accept its own work."
 */
const ledgerEnvelope = {
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  previousDigest: DigestSchema,
  createdAt: TimestampSchema,
  actor: z.literal('human'),
  approvalId: StableIdSchema,
  requestDigest: DigestSchema,
} as const;

export const AcceptanceRecordSchema = z.strictObject({
  kind: z.literal('acceptance'),
  id: StableIdSchema,
  ...ledgerEnvelope,
  featureId: StableIdSchema,
  status: FeatureStatusSchema,
  catalogDigest: DigestSchema,
});
export type AcceptanceRecord = z.infer<typeof AcceptanceRecordSchema>;

/**
 * EL-REQ-BOOT-006. Content corruption on a chain that still validates is
 * corrected by appending this record, which marks superseded sequences without
 * mutating, deleting, or rewriting them.
 */
export const ReconciliationRecordSchema = z.strictObject({
  kind: z.literal('reconciliation'),
  id: StableIdSchema,
  ...ledgerEnvelope,
  featureId: StableIdSchema,
  status: FeatureStatusSchema,
  catalogDigest: DigestSchema,
  supersedes: z.array(z.number().int().nonnegative()).min(1).max(MAX_SUPERSEDED_SEQUENCES),
  issuer: StableIdSchema,
  signatureReference: boundedText(1_024),
  evidenceDigest: DigestSchema,
  reason: BoundedReasonSchema,
});
export type ReconciliationRecord = z.infer<typeof ReconciliationRecordSchema>;

/**
 * EL-REQ-BOOT-007. A broken anchor cannot sign its own replacement, so
 * integrity-chain corruption is never corrected by appending to the broken
 * chain. A new generation opens with this record, which names the break point,
 * the expected and observed digests, and the reconstruction basis.
 */
export const GenesisRecordSchema = z.strictObject({
  kind: z.literal('genesis'),
  id: StableIdSchema,
  ...ledgerEnvelope,
  supersededGeneration: z.number().int().nonnegative().max(MAX_LEDGER_GENERATIONS),
  /**
   * The record the chain broke at, or `null` when the break is not at a record
   * — a truncated final line has no sequence of its own.
   *
   * Nullable rather than coerced: forcing an unterminated tail to report
   * sequence 0 would make a signed, permanent record assert a break at a record
   * that is intact, and EL-REQ-BOOT-007's whole purpose is that this record
   * names the break truthfully.
   */
  breakPointSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  breakReason: z.enum(LEDGER_BREACH_REASONS),
  expectedDigest: DigestSchema,
  observedDigest: DigestSchema,
  reconstructionBasis: boundedText(2_048),
  issuer: StableIdSchema,
  signatureReference: boundedText(1_024),
});
export type GenesisRecord = z.infer<typeof GenesisRecordSchema>;

export const LedgerRecordSchema = z.discriminatedUnion('kind', [
  AcceptanceRecordSchema,
  ReconciliationRecordSchema,
  GenesisRecordSchema,
]);
export type LedgerRecord = z.infer<typeof LedgerRecordSchema>;

export class LedgerIntegrityError extends Error {
  readonly breach: LedgerBreach;

  constructor(breach: LedgerBreach) {
    super(`Acceptance ledger integrity stop at sequence ${breach.sequence}: ${breach.detail}`.slice(0, 1_024));
    this.name = 'LedgerIntegrityError';
    this.breach = breach;
  }
}

export class LedgerStateError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'LedgerStateError';
  }
}

export interface LedgerBreach {
  reason: LedgerBreachReason;
  /** The record the chain broke at, or -1 when the break is the unterminated tail. */
  sequence: number;
  expectedDigest: string;
  observedDigest: string;
  detail: string;
}

export interface LedgerGenerationState {
  generation: number;
  records: readonly LedgerRecord[];
  integrity: 'valid' | 'broken';
  breach: LedgerBreach | null;
}

/**
 * The digest a successor must carry: sha256 of the canonical form of the whole
 * preceding record (EL-REQ-STORE-003 linkage, reusing the `events.ts` helper).
 */
export function ledgerRecordDigest(record: LedgerRecord): string {
  return sha256Canonical(record);
}

export function serializeLedgerRecord(record: LedgerRecord): string {
  return `${canonicalJson(parseBoundary(LedgerRecordSchema, record, 'ledger record serialization'))}\n`;
}

function breach(
  reason: LedgerBreachReason,
  sequence: number,
  detail: string,
  expectedDigest = GENESIS_DIGEST,
  observedDigest = GENESIS_DIGEST
): LedgerBreach {
  return { reason, sequence, expectedDigest, observedDigest, detail };
}

/**
 * Parses one generation's records without throwing on corruption: the ceremony
 * router (EL-REQ-BOOT-005) must be able to observe a break in order to route
 * it. Resolution stops separately, in `resolveFeatureStatus`.
 */
export function parseLedgerGeneration(generation: number, text: string): LedgerGenerationState {
  const invalid = (reason: LedgerBreachReason, sequence: number, detail: string, expected?: string, observed?: string): LedgerGenerationState => ({
    generation,
    records: [],
    integrity: 'broken',
    breach: breach(reason, sequence, detail, expected, observed),
  });

  if (text.length === 0) return { generation, records: [], integrity: 'valid', breach: null };
  if (!text.endsWith('\n')) {
    return invalid('partial_append', -1, 'ledger contains an unterminated final record');
  }
  const lines = text.split('\n');
  lines.pop();
  if (lines.length > MAX_LEDGER_RECORDS) {
    return invalid('invalid_schema', lines.length, `ledger exceeds the ${MAX_LEDGER_RECORDS}-record bound`);
  }

  const records: LedgerRecord[] = [];
  let expectedDigest = GENESIS_DIGEST;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.length === 0) return invalid('invalid_schema', index, 'ledger contains an empty interior record');
    if (Buffer.byteLength(line, 'utf8') > MAX_LEDGER_RECORD_BYTES) {
      return invalid('invalid_schema', index, `ledger record exceeds the ${MAX_LEDGER_RECORD_BYTES}-byte bound`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      return invalid('invalid_schema', index, `ledger record JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    const parsed = LedgerRecordSchema.safeParse(raw);
    if (!parsed.success) {
      return invalid('invalid_schema', index, parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; '));
    }
    const record = parsed.data;
    if (record.sequence !== index) {
      return invalid('missing_sequence', index, `expected sequence ${index}, observed ${record.sequence}`);
    }
    if (record.previousDigest !== expectedDigest) {
      return invalid(
        'digest_mismatch',
        index,
        `previous-record digest does not link to the preceding record`,
        expectedDigest,
        record.previousDigest
      );
    }
    records.push(record);
    expectedDigest = ledgerRecordDigest(record);
  }
  return { generation, records: Object.freeze(records), integrity: 'valid', breach: null };
}

/**
 * The three ceremony predicates of SPEC 6.1. They are disjoint and total, and
 * are re-derived on every attempt rather than carried as a flag a human must
 * remember to clear.
 */
export const LEDGER_CEREMONIES = ['seeding', 'ledger_recovery', 're_genesis'] as const;
export type LedgerCeremony = (typeof LEDGER_CEREMONIES)[number];

export function classifyLedgerGeneration(state: LedgerGenerationState): LedgerCeremony {
  if (state.integrity === 'broken') return 're_genesis';
  if (state.records.length === 0) return 'seeding';
  return 'ledger_recovery';
}

export interface ResolvedFeatureStatus {
  statuses: ReadonlyMap<string, FeatureStatus>;
  acceptedFeatureIds: readonly string[];
  catalogDigests: readonly string[];
  consumedApprovalIds: readonly string[];
  recordCount: number;
  generation: number;
}

/**
 * EL-REQ-BOOT-005: a missing sequence, digest mismatch, invalid schema, or
 * partial append stops resolution. The controller never repairs, truncates, or
 * skips a bad record.
 *
 * Resolution replays in sequence and takes the last record naming a feature as
 * current, so a `reconciliation` supersedes an earlier `acceptance` by ordinary
 * replay rather than by mutation.
 */
export function resolveFeatureStatus(state: LedgerGenerationState): ResolvedFeatureStatus {
  if (state.integrity === 'broken' || state.breach !== null) {
    throw new LedgerIntegrityError(state.breach as LedgerBreach);
  }
  const statuses = new Map<string, FeatureStatus>();
  const catalogDigests: string[] = [];
  const consumedApprovalIds: string[] = [];
  for (const record of state.records) {
    if (!consumedApprovalIds.includes(record.approvalId)) consumedApprovalIds.push(record.approvalId);
    if (record.kind === 'genesis') continue;
    statuses.set(record.featureId, record.status);
    if (!catalogDigests.includes(record.catalogDigest)) catalogDigests.push(record.catalogDigest);
  }
  const acceptedFeatureIds = [...statuses.entries()]
    .filter(([, status]) => status === 'accepted')
    .map(([featureId]) => featureId)
    .sort();
  return {
    statuses,
    acceptedFeatureIds,
    catalogDigests,
    consumedApprovalIds,
    recordCount: state.records.length,
    generation: state.generation,
  };
}

/**
 * `catalogDigest` is provenance, not enforcement: the catalog changes
 * legitimately, so a mismatch is normal and is reported in the derived view
 * rather than refused or silently ignored.
 */
export function catalogProvenanceNotes(resolved: ResolvedFeatureStatus, currentCatalogDigest: string): readonly string[] {
  const stale = resolved.catalogDigests.filter(digest => digest !== currentCatalogDigest);
  if (stale.length === 0) return [];
  return [
    `controller:ledger_catalog_drift: ${stale.length} acceptance record catalog digest(s) differ from the current catalog; recorded for provenance, not enforced.`,
  ];
}

export function catalogDigestOf(catalogValue: unknown): string {
  return sha256Canonical(catalogValue);
}

async function readTextIfPresent(path: string, maxBytes: number): Promise<string | null> {
  try {
    const observed = await stat(path);
    if (observed.size > maxBytes) throw new LedgerStateError(`Ledger file '${path}' exceeds the ${maxBytes}-byte limit`);
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export interface AcceptanceLedgerOptions {
  ledgerRoot: string;
  worktree: string;
  clock: Clock;
  ownerId: string;
  ownerToken: string;
}

/**
 * A single-writer handle over the ledger root. `WriterLock` is reused unchanged:
 * it is scoped by path (`join(root, '.writer.lock')`) and the workflow ID only
 * identifies the holder inside the record, so this distinct root cannot contend
 * with a workflow state root's lock.
 */
export class AcceptanceLedger {
  readonly root: string;
  readonly clock: Clock;
  /** Null on a read-only handle; a write path asserts it before mutating. */
  #lock: WriterLock | null;

  private constructor(root: string, lock: WriterLock | null, clock: Clock) {
    this.root = root;
    this.#lock = lock;
    this.clock = clock;
  }

  get readOnly(): boolean {
    return this.#lock === null;
  }

  /**
   * A read-only handle that takes no writer lock.
   *
   * `EL-REQ-STORE-002` requires the exclusive writer lock before reading mutable
   * state *for execution*; inspection is not execution. A lock-free read is safe
   * here because `appendAll` commits by atomic rename, so a reader observes
   * either the previous file or the next one and never a torn one. Requiring the
   * lock would mean `status` — the command an operator reaches for to diagnose a
   * stuck or locked ledger — is the command that cannot run while it is stuck.
   *
   * The read is consistent per file, not across the pointer and the generation:
   * a re-genesis landing between the two reads yields a stale-but-coherent view.
   * That is acceptable for a report and is never a basis for a write.
   */
  static async openReadOnly(options: Omit<AcceptanceLedgerOptions, 'ownerId' | 'ownerToken'>): Promise<AcceptanceLedger> {
    const root = await validateProtectedStateRoot(options.ledgerRoot, options.worktree);
    return new AcceptanceLedger(root, null, options.clock);
  }

  static async open(options: AcceptanceLedgerOptions): Promise<AcceptanceLedger> {
    const root = await validateProtectedStateRoot(options.ledgerRoot, options.worktree);
    const lock = await WriterLock.acquire({
      root,
      workflowId: PROGRAM_ACCEPTANCE_WORKFLOW_ID,
      ownerId: options.ownerId,
      ownerToken: options.ownerToken,
      createdAt: options.clock.now(),
    });
    return new AcceptanceLedger(root, lock, options.clock);
  }

  generationPath(generation: number): string {
    return join(this.root, LEDGER_GENERATIONS_DIRECTORY, String(generation), LEDGER_RECORD_FILE);
  }

  async currentGeneration(): Promise<number> {
    const text = await readTextIfPresent(join(this.root, LEDGER_CURRENT_FILE), 1_024);
    if (text === null) return 0;
    const parsed = z.number().int().nonnegative().max(MAX_LEDGER_GENERATIONS).safeParse(Number(text.trim()));
    if (!parsed.success) throw new LedgerStateError(`Ledger generation pointer '${text.trim()}' is invalid`);
    return parsed.data;
  }

  async listGenerations(): Promise<readonly number[]> {
    const directory = join(this.root, LEDGER_GENERATIONS_DIRECTORY);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return entries
      .filter(entry => entry.isDirectory() && /^[0-9]+$/.test(entry.name))
      .map(entry => Number(entry.name))
      .sort((a, b) => a - b);
  }

  async readGeneration(generation: number): Promise<LedgerGenerationState> {
    const text = await readTextIfPresent(this.generationPath(generation), MAX_LEDGER_BYTES);
    return parseLedgerGeneration(generation, text ?? '');
  }

  async readCurrentGeneration(): Promise<LedgerGenerationState> {
    return this.readGeneration(await this.currentGeneration());
  }

  /**
   * Every approval identity any parseable record in any generation already
   * consumed. Replay is the consumption record: because each record carries the
   * `approvalId` that authorized it, consumption becomes durable in the same
   * atomic rename as the records themselves, and no separate mutable file can
   * disagree with the ledger.
   *
   * Honest residual: an unparseable line in a corrupt generation cannot
   * contribute, so non-reuse is proven only across parseable history. Re-genesis
   * requires fresh owner-authored material regardless.
   */
  async consumedApprovalIds(): Promise<readonly string[]> {
    const consumed: string[] = [];
    for (const generation of await this.listGenerations()) {
      const text = await readTextIfPresent(this.generationPath(generation), MAX_LEDGER_BYTES);
      if (text === null || text.length === 0) continue;
      for (const line of text.split('\n')) {
        if (line.length === 0) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          continue;
        }
        const parsed = LedgerRecordSchema.safeParse(raw);
        if (parsed.success && !consumed.includes(parsed.data.approvalId)) consumed.push(parsed.data.approvalId);
      }
    }
    return consumed;
  }

  /**
   * Appends every record or none (EL-REQ-BOOT-003). The next bytes are built
   * whole, verified to extend the existing bytes without rewriting a single one,
   * written to a temporary file, synced, and atomically renamed into place. A
   * partial append is therefore not representable rather than merely refused.
   */
  async appendAll(generation: number, records: readonly LedgerRecord[]): Promise<LedgerGenerationState> {
    if (this.#lock === null) {
      throw new LedgerStateError('Read-only ledger handle cannot append; open with the writer lock to mutate');
    }
    if (records.length === 0) throw new LedgerStateError('Ledger append requires at least one record');
    // The generation pointer only ever moves forward. Without this, a caller
    // naming an older generation would silently repoint the ledger backwards at
    // superseded history. Nothing reaches that today — a superseded generation
    // is broken, so the integrity check below throws first — but the pointer on
    // a trust anchor should be monotonic by construction, not by luck of the
    // caller.
    const current = await this.currentGeneration();
    if (generation < current) {
      throw new LedgerStateError(
        `Ledger append to generation ${generation} would move the current pointer back from ${current}`
      );
    }
    const path = this.generationPath(generation);
    await mkdir(join(this.root, LEDGER_GENERATIONS_DIRECTORY, String(generation)), { recursive: true, mode: 0o700 });
    const existing = (await readTextIfPresent(path, MAX_LEDGER_BYTES)) ?? '';
    const existingState = parseLedgerGeneration(generation, existing);
    if (existingState.integrity === 'broken') {
      throw new LedgerIntegrityError(existingState.breach as LedgerBreach);
    }

    let expectedSequence = existingState.records.length;
    let expectedDigest = existingState.records.length === 0
      ? GENESIS_DIGEST
      : ledgerRecordDigest(existingState.records[existingState.records.length - 1]);
    let appended = '';
    for (const candidate of records) {
      const record = parseBoundary(LedgerRecordSchema, candidate, 'ledger append record');
      if (record.sequence !== expectedSequence) {
        throw new LedgerStateError(`Ledger append expected sequence ${expectedSequence}, observed ${record.sequence}`);
      }
      if (record.previousDigest !== expectedDigest) {
        throw new LedgerStateError(`Ledger append record ${record.sequence} does not link to the preceding record`);
      }
      appended += serializeLedgerRecord(record);
      expectedSequence++;
      expectedDigest = ledgerRecordDigest(record);
    }

    const next = existing + appended;
    if (!next.startsWith(existing)) {
      throw new LedgerStateError('Ledger append would rewrite existing history');
    }
    if (Buffer.byteLength(next, 'utf8') > MAX_LEDGER_BYTES) {
      throw new LedgerStateError(`Ledger would exceed the ${MAX_LEDGER_BYTES}-byte bound`);
    }
    const verified = parseLedgerGeneration(generation, next);
    if (verified.integrity === 'broken') {
      throw new LedgerIntegrityError(verified.breach as LedgerBreach);
    }

    // Truncate rather than exclusive-create. The temp path is deterministic, so
    // a crash between this write and the rename below would otherwise leave a
    // file that makes every retry fail EEXIST forever, recoverable only by a
    // human deleting a file inside the protected root — the untrusted-side write
    // the recovery ceremonies exist to eliminate. Truncating is safe because an
    // exclusive writer lock is held for the whole of this call, so no concurrent
    // writer can own this path, and the rename below is what commits.
    const tempPath = `${path}.${expectedSequence}.tmp`;
    const handle = await open(tempPath, 'w', 0o600);
    try {
      await handle.writeFile(next, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, path);
    await this.writeCurrentGeneration(generation);
    return verified;
  }

  async writeCurrentGeneration(generation: number): Promise<void> {
    const path = join(this.root, LEDGER_CURRENT_FILE);
    const tempPath = `${path}.${generation}.tmp`;
    const handle = await open(tempPath, 'w', 0o600);
    try {
      await handle.writeFile(`${generation}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, path);
  }

  async close(): Promise<void> {
    if (this.#lock === null) return;
    await this.#lock.release();
  }
}
