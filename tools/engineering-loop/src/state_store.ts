import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  EventPayloadSchema,
  MAX_PATH_LENGTH,
  StateSnapshotSchema,
  parseBoundary,
  type ActorAuthority,
  type DomainEvent,
  type EventPayload,
  type StateSnapshot,
} from './domain.js';
import {
  canonicalJson,
  createDomainEvent,
  serializeEvent,
  verifyDomainEvent,
} from './events.js';
import { applyDomainEvent } from './state_machine.js';
import { WriterLock } from './writer_lock.js';

export const CRASH_POINTS = [
  'before_journal_append',
  'after_journal_durable',
  'before_snapshot_temp_write',
  'after_snapshot_temp_durable',
  'before_snapshot_replace',
  'after_snapshot_replace',
  'before_approval_consumption',
  'after_approval_consumption',
  'before_intent_record',
  'after_intent_record',
  'before_effect_invocation',
  'after_effect_invocation',
  'before_outcome_record',
  'after_outcome_record',
] as const;

export type CrashPoint = (typeof CRASH_POINTS)[number];

export interface CrashInjector {
  hit(point: CrashPoint): void;
}

export interface Clock {
  now(): string;
}

export const NO_CRASHES: CrashInjector = { hit: () => undefined };

export class InjectedCrashError extends Error {
  readonly point: CrashPoint;

  constructor(point: CrashPoint) {
    super(`Injected crash at ${point}`);
    this.name = 'InjectedCrashError';
    this.point = point;
  }
}

export class StateRootError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'StateRootError';
  }
}

export class StateRecoveryError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'StateRecoveryError';
  }
}

function isContained(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

const MAX_WORKTREE_SECURITY_ENTRIES = 100_000;
const MAX_JOURNAL_BYTES = 256 * 1_024 * 1_024;
const MAX_EVENT_BYTES = 1_024 * 1_024;
const MAX_EVENT_RECORDS = 1_000_000;
const MAX_SNAPSHOT_BYTES = 16 * 1_024 * 1_024;

function validateExternalPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) {
    throw new StateRootError(`${label} must be a nonempty path no longer than ${MAX_PATH_LENGTH} characters`);
  }
  return value;
}

async function refuseWorktreeAliasToState(worktree: string, stateRoot: string): Promise<void> {
  const pending = [worktree];
  let observedEntries = 0;
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      observedEntries++;
      if (observedEntries > MAX_WORKTREE_SECURITY_ENTRIES) {
        throw new StateRootError('Assigned worktree exceeds the bounded state-root alias security scan');
      }
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        let target: string;
        try {
          target = resolve(await realpath(path));
        } catch (error) {
          throw new StateRootError(
            `Assigned worktree contains an unreadable symbolic link '${path}': ${error instanceof Error ? error.message : String(error)}`
          );
        }
        if (isContained(stateRoot, target) || isContained(target, stateRoot)) {
          throw new StateRootError('Protected state root is writable through a symbolic-link alias in the assigned worktree');
        }
        continue;
      }
      if (entry.isDirectory()) pending.push(path);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function canonicalProspectivePath(path: string): Promise<string> {
  const missing: string[] = [];
  let cursor = resolve(path);
  while (!(await exists(cursor))) {
    const parent = dirname(cursor);
    if (parent === cursor) throw new StateRootError(`No existing ancestor for state root '${path}'`);
    missing.unshift(cursor.slice(parent.length + 1));
    cursor = parent;
  }
  return resolve(await realpath(cursor), ...missing);
}

export async function validateProtectedStateRoot(stateRoot: string, worktree: string): Promise<string> {
  const lexicalRoot = resolve(validateExternalPath(stateRoot, 'Protected state root'));
  const lexicalWorktree = resolve(validateExternalPath(worktree, 'Assigned worktree'));
  if (isContained(lexicalWorktree, lexicalRoot)) {
    throw new StateRootError('Protected state root must not be inside the assigned worktree');
  }

  const canonicalWorktree = await realpath(lexicalWorktree);
  const canonicalCandidate = await canonicalProspectivePath(lexicalRoot);
  if (isContained(canonicalWorktree, canonicalCandidate)) {
    throw new StateRootError('Protected state root resolves or aliases into the assigned worktree');
  }

  if (await exists(lexicalRoot)) {
    const rootLstat = await lstat(lexicalRoot);
    if (rootLstat.isSymbolicLink()) {
      throw new StateRootError('Protected state root itself must not be a symbolic link');
    }
  } else {
    await mkdir(lexicalRoot, { recursive: true, mode: 0o700 });
  }

  const canonicalRoot = await realpath(lexicalRoot);
  if (isContained(canonicalWorktree, canonicalRoot)) {
    throw new StateRootError('Protected state root canonicalizes inside the assigned worktree');
  }
  await refuseWorktreeAliasToState(canonicalWorktree, canonicalRoot);
  if (process.platform !== 'win32') {
    const mode = (await stat(canonicalRoot)).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new StateRootError('Protected state root must deny group and other permissions');
    }
    await chmod(canonicalRoot, 0o700);
  }
  return canonicalRoot;
}

async function readJsonIfPresent(path: string, maxBytes: number): Promise<unknown | null> {
  try {
    const observed = await stat(path);
    if (observed.size > maxBytes) {
      throw new StateRecoveryError(`Persisted JSON '${path}' exceeds the ${maxBytes}-byte limit`);
    }
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new StateRecoveryError(
      `Persisted JSON '${path}' is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function cloneSnapshot(snapshot: StateSnapshot | null): StateSnapshot | null {
  if (snapshot === null) return null;
  return parseBoundary(StateSnapshotSchema, JSON.parse(canonicalJson(snapshot)), 'snapshot clone');
}

export interface StateStoreOptions {
  stateRoot: string;
  worktree: string;
  workflowId: string;
  ownerId: string;
  ownerToken: string;
  clock: Clock;
  crashInjector?: CrashInjector;
}

export class StateStore {
  readonly root: string;
  readonly journalPath: string;
  readonly snapshotPath: string;
  readonly crashInjector: CrashInjector;
  readonly clock: Clock;
  #lock: WriterLock;
  #snapshot: StateSnapshot | null;
  #commitInProgress = false;

  private constructor(input: {
    root: string;
    lock: WriterLock;
    snapshot: StateSnapshot | null;
    clock: Clock;
    crashInjector: CrashInjector;
  }) {
    this.root = input.root;
    this.journalPath = join(input.root, 'events.jsonl');
    this.snapshotPath = join(input.root, 'snapshot.json');
    this.#lock = input.lock;
    this.#snapshot = input.snapshot;
    this.clock = input.clock;
    this.crashInjector = input.crashInjector;
  }

  static async open(options: StateStoreOptions): Promise<StateStore> {
    const root = await validateProtectedStateRoot(options.stateRoot, options.worktree);
    const lock = await WriterLock.acquire({
      root,
      workflowId: options.workflowId,
      ownerId: options.ownerId,
      ownerToken: options.ownerToken,
      createdAt: options.clock.now(),
    });
    try {
      const snapshot = await StateStore.reconstruct(root);
      if (snapshot !== null && snapshot.workflowId !== options.workflowId) {
        throw new StateRecoveryError('State root belongs to another workflow');
      }
      return new StateStore({
        root,
        lock,
        snapshot,
        clock: options.clock,
        crashInjector: options.crashInjector ?? NO_CRASHES,
      });
    } catch (error) {
      await lock.release();
      throw error;
    }
  }

  get snapshot(): StateSnapshot | null {
    return cloneSnapshot(this.#snapshot);
  }

  private static async readEvents(root: string): Promise<DomainEvent[]> {
    const journalPath = join(root, 'events.jsonl');
    let text: string;
    try {
      const observed = await stat(journalPath);
      if (observed.size > MAX_JOURNAL_BYTES) {
        throw new StateRecoveryError(`Event journal exceeds the ${MAX_JOURNAL_BYTES}-byte limit`);
      }
      text = await readFile(journalPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    if (text.length === 0) return [];
    if (!text.endsWith('\n')) {
      throw new StateRecoveryError('Event journal contains an unterminated final record');
    }
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    if (lines.length > MAX_EVENT_RECORDS) {
      throw new StateRecoveryError(`Event journal exceeds the ${MAX_EVENT_RECORDS}-record limit`);
    }
    if (lines.some(line => line.length === 0)) {
      throw new StateRecoveryError('Event journal contains an empty interior record');
    }
    if (lines.some(line => Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES)) {
      throw new StateRecoveryError(`Event journal contains a record over the ${MAX_EVENT_BYTES}-byte limit`);
    }
    return lines.map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        throw new StateRecoveryError(
          `Event journal JSON is invalid at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }) as DomainEvent[];
  }

  static async reconstruct(root: string): Promise<StateSnapshot | null> {
    const rawEvents = await StateStore.readEvents(root);
    const rawSnapshot = await readJsonIfPresent(join(root, 'snapshot.json'), MAX_SNAPSHOT_BYTES);
    let published: StateSnapshot | null = null;
    if (rawSnapshot !== null) {
      try {
        published = parseBoundary(StateSnapshotSchema, rawSnapshot, 'published snapshot');
      } catch (error) {
        throw new StateRecoveryError(error instanceof Error ? error.message : String(error));
      }
    }

    let replayed: StateSnapshot | null = null;
    let matchedPublishedSnapshot = false;
    let expectedDigest = '0'.repeat(64);
    for (let index = 0; index < rawEvents.length; index++) {
      let event: DomainEvent;
      try {
        event = verifyDomainEvent(rawEvents[index], index + 1, expectedDigest);
        const next = applyDomainEvent(replayed, event);
        if (published !== null && event.sequence === published.lastEventSequence) {
          if (canonicalJson(published) !== canonicalJson(next)) {
            throw new StateRecoveryError('Snapshot and journal disagree at the published sequence');
          }
          replayed = published;
          matchedPublishedSnapshot = true;
        } else {
          replayed = next;
        }
      } catch (error) {
        throw new StateRecoveryError(
          `Event replay stopped at sequence ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      expectedDigest = event.digest;
    }

    if (published !== null && !matchedPublishedSnapshot) {
      throw new StateRecoveryError('Snapshot refers to an event sequence absent from the journal');
    }
    return replayed;
  }

  private async appendEvent(event: DomainEvent): Promise<void> {
    const handle = await open(this.journalPath, 'a', 0o600);
    try {
      await handle.writeFile(serializeEvent(event), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async writeSnapshot(snapshot: StateSnapshot): Promise<void> {
    const validated = parseBoundary(StateSnapshotSchema, snapshot, 'snapshot write');
    const tempPath = `${this.snapshotPath}.${validated.lastEventSequence}.${validated.lastEventDigest}.tmp`;
    const handle = await open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${canonicalJson(validated)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.crashInjector.hit('after_snapshot_temp_durable');
    this.crashInjector.hit('before_snapshot_replace');
    await rename(tempPath, this.snapshotPath);
    this.crashInjector.hit('after_snapshot_replace');
  }

  async commit(payloadValue: unknown, actor: ActorAuthority): Promise<StateSnapshot> {
    if (this.#commitInProgress) {
      throw new StateRecoveryError('Concurrent mutation through one writer instance is forbidden');
    }
    this.#commitInProgress = true;
    try {
      const payload = parseBoundary(EventPayloadSchema, payloadValue, 'state-store event payload');
      const event = createDomainEvent({
        current: this.#snapshot,
        payload,
        actor,
        createdAt: this.clock.now(),
      });
      const next = applyDomainEvent(this.#snapshot, event);

      this.crashInjector.hit('before_journal_append');
      await this.appendEvent(event);
      this.crashInjector.hit('after_journal_durable');
      this.crashInjector.hit('before_snapshot_temp_write');
      await this.writeSnapshot(next);
      this.#snapshot = next;
      return cloneSnapshot(next) as StateSnapshot;
    } finally {
      this.#commitInProgress = false;
    }
  }

  async close(): Promise<void> {
    if (this.#commitInProgress) throw new StateRecoveryError('Cannot release writer lock during a commit');
    await this.#lock.release();
  }
}
