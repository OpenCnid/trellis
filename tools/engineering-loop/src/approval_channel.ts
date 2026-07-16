import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { parseBoundary } from './domain.js';
import { validateProtectedStateRoot } from './state_store.js';
import type { ProtectedApprovalChannel } from './policy.js';

/**
 * The concrete `ProtectedApprovalChannel` (EL-REQ-APPROVAL-002): approval truth
 * is issued and stored outside the agent-writable worktree, and the controller
 * only ever reads it.
 *
 * Until now the only implementation of this interface was a test-local class.
 * The interface was proven and the adapter was never built, which is the same
 * shape of gap EL-10 exists to close.
 *
 * The channel holds one owner-authored JSON file: an array of approval records.
 * One file rather than one file per approval is deliberate — approval
 * identifiers are stable identifiers that legitimately contain `:`, which is not
 * a usable filename character on Windows, and inventing an escaping scheme would
 * put a decoding step between the owner's bytes and the controller's read.
 *
 * This module validates and locates. It never writes, never creates approval
 * material, and never defaults a missing approval to anything but `null`.
 */

export const APPROVAL_CHANNEL_FILE = 'approvals.json';
export const MAX_APPROVAL_CHANNEL_BYTES = 256 * 1_024;
export const MAX_APPROVAL_CHANNEL_RECORDS = 64;

export class ApprovalChannelError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'ApprovalChannelError';
  }
}

/**
 * The channel file is parsed as bounded opaque entries carrying an `id`. Full
 * `ProtectedApprovalRecordSchema` validation, digest verification, scope
 * matching, expiry, and consumption checks all remain in
 * `authorizeProtectedAction`, which is the accepted EL-06 authority for them.
 * Duplicating that validation here would create a second opinion about what a
 * valid approval is.
 */
const ChannelEntrySchema = z.looseObject({ id: z.string().min(1).max(128) });
const ChannelFileSchema = z.array(ChannelEntrySchema).max(MAX_APPROVAL_CHANNEL_RECORDS);

export interface FileApprovalChannelOptions {
  channelDirectory: string;
  worktree: string;
}

export class FileProtectedApprovalChannel implements ProtectedApprovalChannel {
  readonly location = 'protected_external' as const;
  readonly directory: string;
  readonly filePath: string;
  #reads = 0;

  private constructor(directory: string) {
    this.directory = directory;
    this.filePath = join(directory, APPROVAL_CHANNEL_FILE);
  }

  get reads(): number {
    return this.#reads;
  }

  /**
   * The channel directory is validated by the same `validateProtectedStateRoot`
   * the state root uses: it must not be inside, alias into, or be reachable by
   * symbolic link from the assigned worktree.
   */
  static async open(options: FileApprovalChannelOptions): Promise<FileProtectedApprovalChannel> {
    const directory = await validateProtectedStateRoot(options.channelDirectory, options.worktree);
    return new FileProtectedApprovalChannel(directory);
  }

  async readAll(): Promise<readonly unknown[]> {
    let text: string;
    try {
      const observed = await stat(this.filePath);
      if (observed.size > MAX_APPROVAL_CHANNEL_BYTES) {
        throw new ApprovalChannelError(
          `Approval channel file exceeds the ${MAX_APPROVAL_CHANNEL_BYTES}-byte limit`
        );
      }
      text = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new ApprovalChannelError(
        `Approval channel file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const entries = parseBoundary(ChannelFileSchema, raw, 'protected approval channel file');
    const ids = entries.map(entry => entry.id);
    if (new Set(ids).size !== ids.length) {
      throw new ApprovalChannelError('Approval channel file contains duplicate approval identifiers');
    }
    return entries;
  }

  async read(approvalId: string): Promise<unknown | null> {
    this.#reads++;
    const entries = await this.readAll();
    const match = entries.filter(entry => (entry as { id: string }).id === approvalId);
    if (match.length === 0) return null;
    return structuredClone(match[0]);
  }
}
