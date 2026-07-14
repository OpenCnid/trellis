import { open, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { DOMAIN_SCHEMA_VERSION, parseBoundary } from './domain.js';
import { canonicalJson } from './events.js';

const WriterLockRecordSchema = z.strictObject({
  id: z.string().min(1).max(128),
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: z.string().datetime({ offset: true }),
  workflowId: z.string().min(1).max(128),
  ownerId: z.string().min(1).max(128),
  ownerToken: z.string().min(16).max(128),
  processId: z.number().int().positive().max(2_147_483_647),
});
const MAX_WRITER_LOCK_BYTES = 16 * 1_024;

export type WriterLockRecord = z.infer<typeof WriterLockRecordSchema>;

export class WriterLockError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'WriterLockError';
  }
}

export class WriterLock {
  readonly path: string;
  readonly record: WriterLockRecord;
  #released = false;

  private constructor(path: string, record: WriterLockRecord) {
    this.path = path;
    this.record = record;
  }

  static async acquire(input: {
    root: string;
    workflowId: string;
    ownerId: string;
    ownerToken: string;
    createdAt: string;
    processId?: number;
  }): Promise<WriterLock> {
    const path = join(input.root, '.writer.lock');
    const record = parseBoundary(WriterLockRecordSchema, {
      id: `lock:${input.workflowId}`,
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      createdAt: input.createdAt,
      workflowId: input.workflowId,
      ownerId: input.ownerId,
      ownerToken: input.ownerToken,
      processId: input.processId ?? process.pid,
    }, 'writer lock');
    let handle;
    try {
      handle = await open(path, 'wx', 0o600);
      await handle.writeFile(`${canonicalJson(record)}\n`, 'utf8');
      await handle.sync();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new WriterLockError(
          'A writer lock already exists; automatic stale-lock stealing is forbidden and requires explicit reconciliation'
        );
      }
      throw error;
    } finally {
      await handle?.close();
    }
    return new WriterLock(path, record);
  }

  static async inspect(path: string): Promise<WriterLockRecord> {
    let parsed: unknown;
    try {
      if ((await stat(path)).size > MAX_WRITER_LOCK_BYTES) {
        throw new WriterLockError(`Writer lock exceeds the ${MAX_WRITER_LOCK_BYTES}-byte limit`);
      }
      parsed = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      throw new WriterLockError(`Writer lock cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    return parseBoundary(WriterLockRecordSchema, parsed, 'writer lock read');
  }

  async release(): Promise<void> {
    if (this.#released) return;
    const observed = await WriterLock.inspect(this.path);
    if (observed.ownerToken !== this.record.ownerToken) {
      throw new WriterLockError('Writer lock ownership changed; refusing to remove another writer lock');
    }
    await unlink(this.path);
    this.#released = true;
  }
}
