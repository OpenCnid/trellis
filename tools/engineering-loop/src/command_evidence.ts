import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  access,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import {
  DOMAIN_SCHEMA_VERSION,
  EvidenceSchema,
  MAX_ID_LENGTH,
  MAX_PATH_LENGTH,
  StableIdSchema,
  parseBoundary,
  type Evidence,
} from './domain.js';
import { canonicalJson, sha256Canonical } from './events.js';
import { validateProtectedStateRoot, type Clock, type StateStore } from './state_store.js';

export const MAX_COMMAND_ARGV_ITEMS = 64;
export const MAX_COMMAND_ARG_BYTES = 2_048;
export const MAX_COMMAND_ARGV_BYTES = 16 * 1_024;
export const MAX_COMMAND_OUTPUT_BYTES = 8 * 1_024 * 1_024;
export const MAX_COMMAND_PREVIEW_BYTES = 4 * 1_024;
export const MAX_RETAINED_ARTIFACT_BYTES = 16 * 1_024 * 1_024;

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const MediaTypeSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i);
const ArtifactRelativePathSchema = z.string().regex(/^artifacts\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/);

export class CommandEvidenceError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'CommandEvidenceError';
  }
}

export const RetainedArtifactReferenceSchema = z.strictObject({
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  digest: DigestSchema,
  mediaType: MediaTypeSchema,
  byteCount: z.number().int().nonnegative().max(MAX_RETAINED_ARTIFACT_BYTES),
  relativePath: ArtifactRelativePathSchema,
  journalReference: StableIdSchema,
});

export type RetainedArtifactReference = z.infer<typeof RetainedArtifactReferenceSchema>;

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isContained(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export class ProtectedArtifactStore {
  readonly root: string;
  readonly artifactsRoot: string;
  readonly maxArtifactBytes: number;
  #tempSequence = 0;

  private constructor(root: string, maxArtifactBytes: number) {
    this.root = root;
    this.artifactsRoot = join(root, 'artifacts', 'sha256');
    this.maxArtifactBytes = maxArtifactBytes;
  }

  static async open(input: {
    protectedRoot: string;
    worktree: string;
    maxArtifactBytes?: number;
  }): Promise<ProtectedArtifactStore> {
    const maxArtifactBytes = input.maxArtifactBytes ?? MAX_RETAINED_ARTIFACT_BYTES;
    if (!Number.isInteger(maxArtifactBytes) || maxArtifactBytes < 1 || maxArtifactBytes > MAX_RETAINED_ARTIFACT_BYTES) {
      throw new CommandEvidenceError(`Artifact byte limit must be from 1 through ${MAX_RETAINED_ARTIFACT_BYTES}`);
    }
    const root = await validateProtectedStateRoot(input.protectedRoot, input.worktree);
    await mkdir(join(root, 'artifacts', 'sha256'), { recursive: true, mode: 0o700 });
    return new ProtectedArtifactStore(root, maxArtifactBytes);
  }

  private pathForDigest(digest: string): { relativePath: string; absolutePath: string } {
    const relativePath = `artifacts/sha256/${digest.slice(0, 2)}/${digest}`;
    return { relativePath, absolutePath: join(this.root, ...relativePath.split('/')) };
  }

  private async verifyExisting(
    absolutePath: string,
    expectedDigest: string,
    expectedByteCount: number
  ): Promise<void> {
    const observed = await lstat(absolutePath);
    if (observed.isSymbolicLink() || !observed.isFile()) {
      throw new CommandEvidenceError('Retained artifact path is an alias or is not a regular file');
    }
    const canonical = await realpath(absolutePath);
    if (!isContained(this.root, canonical)) {
      throw new CommandEvidenceError('Retained artifact canonical path escapes the protected root');
    }
    if (observed.size !== expectedByteCount) {
      throw new CommandEvidenceError('Retained artifact byte count disagrees with its digest reference');
    }
    const bytes = await readFile(absolutePath);
    if (sha256Bytes(bytes) !== expectedDigest) {
      throw new CommandEvidenceError('Retained artifact bytes disagree with their digest reference');
    }
  }

  async put(
    byteValue: Uint8Array,
    mediaTypeValue: unknown,
    journalReferenceValue: unknown
  ): Promise<RetainedArtifactReference> {
    if (!(byteValue instanceof Uint8Array)) throw new CommandEvidenceError('Retained artifact must be bytes');
    if (byteValue.byteLength > this.maxArtifactBytes) {
      throw new CommandEvidenceError(`Retained artifact exceeds the ${this.maxArtifactBytes}-byte limit`);
    }
    const mediaType = parseBoundary(MediaTypeSchema, mediaTypeValue, 'artifact media type');
    const journalReference = parseBoundary(StableIdSchema, journalReferenceValue, 'artifact journal reference');
    const bytes = Buffer.from(byteValue);
    const digest = sha256Bytes(bytes);
    const { relativePath, absolutePath } = this.pathForDigest(digest);
    await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });

    try {
      await access(absolutePath);
      await this.verifyExisting(absolutePath, digest, bytes.byteLength);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const tempPath = `${absolutePath}.tmp-${process.pid}-${++this.#tempSequence}`;
      const handle = await open(tempPath, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await this.verifyExisting(tempPath, digest, bytes.byteLength);
        try {
          await link(tempPath, absolutePath);
        } catch (linkError) {
          if ((linkError as NodeJS.ErrnoException).code !== 'EEXIST') throw linkError;
        }
        await this.verifyExisting(absolutePath, digest, bytes.byteLength);
      } finally {
        await rm(tempPath, { force: true });
      }
    }

    return parseBoundary(RetainedArtifactReferenceSchema, {
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      digest,
      mediaType,
      byteCount: bytes.byteLength,
      relativePath,
      journalReference,
    }, 'retained artifact reference');
  }

  async read(referenceValue: unknown): Promise<Buffer> {
    const reference = parseBoundary(RetainedArtifactReferenceSchema, referenceValue, 'retained artifact read reference');
    const expected = this.pathForDigest(reference.digest);
    if (reference.relativePath !== expected.relativePath) {
      throw new CommandEvidenceError('Retained artifact reference aliases its digest path');
    }
    await this.verifyExisting(expected.absolutePath, reference.digest, reference.byteCount);
    return readFile(expected.absolutePath);
  }
}

const CommandArgSchema = z.string().max(MAX_COMMAND_ARG_BYTES)
  .refine(value => Buffer.byteLength(value, 'utf8') <= MAX_COMMAND_ARG_BYTES, `argv item exceeds ${MAX_COMMAND_ARG_BYTES} bytes`)
  .refine(value => !value.includes('\0'), 'argv item contains NUL');
const CommandArgvSchema = z.array(CommandArgSchema).min(1).max(MAX_COMMAND_ARGV_ITEMS).superRefine((argv, ctx) => {
  if (argv.reduce((total, item) => total + Buffer.byteLength(item, 'utf8'), 0) > MAX_COMMAND_ARGV_BYTES) {
    ctx.addIssue({ code: 'custom', message: `argv exceeds ${MAX_COMMAND_ARGV_BYTES} bytes` });
  }
});

export const CommandRequestSchema = z.strictObject({
  evidenceId: StableIdSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  argv: CommandArgvSchema,
  cwd: z.string().min(1).max(MAX_PATH_LENGTH),
  timeoutMs: z.number().int().positive().max(3_600_000),
  stdoutMediaType: MediaTypeSchema.default('application/octet-stream'),
  stderrMediaType: MediaTypeSchema.default('application/octet-stream'),
});

export type CommandRequest = z.infer<typeof CommandRequestSchema>;

const OutputMetadataSchema = z.strictObject({
  byteCount: z.number().int().nonnegative().max(MAX_COMMAND_OUTPUT_BYTES),
  digest: DigestSchema,
  previewByteCount: z.number().int().nonnegative().max(MAX_COMMAND_PREVIEW_BYTES),
  previewBase64: z.string().max(Math.ceil(MAX_COMMAND_PREVIEW_BYTES / 3) * 4 + 4),
  mediaType: MediaTypeSchema,
  retained: RetainedArtifactReferenceSchema.nullable(),
}).superRefine((output, ctx) => {
  if ((output.byteCount === 0) !== (output.retained === null)) {
    ctx.addIssue({
      code: 'custom',
      path: ['retained'],
      message: 'nonempty command output requires a protected full-byte artifact and empty output requires none',
    });
  }
});

export const CommandObservationSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  origin: z.literal('controller_observed'),
  argv: CommandArgvSchema,
  cwd: z.string().min(1).max(MAX_PATH_LENGTH),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema,
  exitCode: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable(),
  signal: z.string().min(1).max(64).nullable(),
  timedOut: z.boolean(),
  cancelled: z.boolean(),
  stdout: OutputMetadataSchema,
  stderr: OutputMetadataSchema,
}).superRefine((observation, ctx) => {
  if ((observation.exitCode === null) === (observation.signal === null)) {
    ctx.addIssue({ code: 'custom', path: ['exitCode'], message: 'exactly one of exitCode or signal is required' });
  }
});

export type CommandObservation = z.infer<typeof CommandObservationSchema>;

export const CommandEvidenceResultSchema = z.strictObject({
  observation: CommandObservationSchema,
  evidence: EvidenceSchema,
  recordReference: RetainedArtifactReferenceSchema,
});

export type CommandEvidenceResult = z.infer<typeof CommandEvidenceResultSchema>;

export interface ExecutedCommand {
  result: CommandEvidenceResult;
  stdout: Buffer;
  stderr: Buffer;
}

function outputMetadata(
  bytes: Buffer,
  mediaType: string,
  retained: RetainedArtifactReference | null,
  previewBytes: number
): z.infer<typeof OutputMetadataSchema> {
  const preview = bytes.subarray(0, Math.min(bytes.byteLength, previewBytes));
  return {
    byteCount: bytes.byteLength,
    digest: sha256Bytes(bytes),
    previewByteCount: preview.byteLength,
    previewBase64: preview.toString('base64'),
    mediaType,
    retained,
  };
}

export class BoundedCommandExecutor {
  readonly clock: Clock;
  readonly artifacts: ProtectedArtifactStore;
  readonly maxOutputBytes: number;
  readonly previewBytes: number;

  constructor(input: {
    clock: Clock;
    artifacts: ProtectedArtifactStore;
    maxOutputBytes?: number;
    previewBytes?: number;
  }) {
    this.clock = input.clock;
    this.artifacts = input.artifacts;
    this.maxOutputBytes = input.maxOutputBytes ?? MAX_COMMAND_OUTPUT_BYTES;
    this.previewBytes = input.previewBytes ?? MAX_COMMAND_PREVIEW_BYTES;
    if (!Number.isInteger(this.maxOutputBytes) || this.maxOutputBytes < 1 || this.maxOutputBytes > MAX_COMMAND_OUTPUT_BYTES) {
      throw new CommandEvidenceError(`Command output limit must be from 1 through ${MAX_COMMAND_OUTPUT_BYTES}`);
    }
    if (!Number.isInteger(this.previewBytes) || this.previewBytes < 0 || this.previewBytes > MAX_COMMAND_PREVIEW_BYTES) {
      throw new CommandEvidenceError(`Command preview limit must be from 0 through ${MAX_COMMAND_PREVIEW_BYTES}`);
    }
  }

  async execute(requestValue: unknown, signal?: AbortSignal): Promise<ExecutedCommand> {
    const request = parseBoundary(CommandRequestSchema, requestValue, 'command request');
    if (!isAbsolute(request.cwd)) throw new CommandEvidenceError('Command cwd must be absolute');
    const cwd = await realpath(resolve(request.cwd));
    if (cwd.length > MAX_PATH_LENGTH || !(await stat(cwd)).isDirectory()) {
      throw new CommandEvidenceError('Command cwd must resolve to a bounded directory');
    }
    if (signal?.aborted) throw new CommandEvidenceError('Command was cancelled before process creation');

    const startedAt = this.clock.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputOverLimit = false;
    let timedOut = false;
    let cancelled = false;

    const completion = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolvePromise, reject) => {
      const child = spawn(request.argv[0], request.argv.slice(1), {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const collect = (target: Buffer[], chunkValue: Buffer | string, stream: 'stdout' | 'stderr') => {
        const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
        if (stream === 'stdout') stdoutBytes += chunk.byteLength;
        else stderrBytes += chunk.byteLength;
        if (stdoutBytes > this.maxOutputBytes || stderrBytes > this.maxOutputBytes) {
          outputOverLimit = true;
          child.kill('SIGTERM');
          return;
        }
        target.push(chunk);
      };
      child.stdout.on('data', chunk => collect(stdoutChunks, chunk, 'stdout'));
      child.stderr.on('data', chunk => collect(stderrChunks, chunk, 'stderr'));
      child.once('error', reject);
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, request.timeoutMs);
      const onAbort = () => {
        if (!timedOut) cancelled = true;
        child.kill('SIGTERM');
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      child.once('close', (exitCode, processSignal) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolvePromise({ exitCode, signal: processSignal });
      });
    });

    if (outputOverLimit) {
      throw new CommandEvidenceError(`Command output exceeds the ${this.maxOutputBytes}-byte per-stream limit`);
    }
    if (completion.exitCode === null && completion.signal === null) {
      throw new CommandEvidenceError('Command completed without an exit status or signal');
    }
    const stdout = Buffer.concat(stdoutChunks, stdoutBytes);
    const stderr = Buffer.concat(stderrChunks, stderrBytes);
    const stdoutRetained = stdout.byteLength === 0
      ? null
      : await this.artifacts.put(stdout, request.stdoutMediaType, request.evidenceId);
    const stderrRetained = stderr.byteLength === 0
      ? null
      : await this.artifacts.put(stderr, request.stderrMediaType, request.evidenceId);
    const endedAt = this.clock.now();
    const observation = parseBoundary(CommandObservationSchema, {
      id: request.evidenceId,
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      createdAt: startedAt,
      workflowId: request.workflowId,
      featureId: request.featureId,
      sessionId: request.sessionId,
      origin: 'controller_observed',
      argv: request.argv,
      cwd,
      startedAt,
      endedAt,
      exitCode: completion.exitCode,
      signal: completion.signal,
      timedOut,
      cancelled,
      stdout: outputMetadata(stdout, request.stdoutMediaType, stdoutRetained, this.previewBytes),
      stderr: outputMetadata(stderr, request.stderrMediaType, stderrRetained, this.previewBytes),
    }, 'command observation');
    const observationBytes = Buffer.from(canonicalJson(observation), 'utf8');
    const recordReference = await this.artifacts.put(
      observationBytes,
      'application/vnd.trellis.engineering-loop.command-observation+json',
      request.evidenceId
    );
    const observedAt = endedAt;
    const evidence = parseBoundary(EvidenceSchema, {
      id: request.evidenceId,
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      createdAt: startedAt,
      workflowId: request.workflowId,
      featureId: request.featureId,
      sessionId: request.sessionId,
      origin: 'controller_observed',
      observedAt,
      digest: sha256Canonical(observation),
      immutableReference: `artifact:sha256:${recordReference.digest}`,
      mediaType: recordReference.mediaType,
      byteCount: recordReference.byteCount,
      metadata: [
        { key: 'argv_count', value: String(request.argv.length) },
        { key: 'exit_status', value: completion.exitCode === null ? `signal:${completion.signal}` : String(completion.exitCode) },
        { key: 'stdout_bytes', value: String(stdout.byteLength) },
        { key: 'stderr_bytes', value: String(stderr.byteLength) },
      ],
    }, 'command evidence');
    return {
      result: parseBoundary(CommandEvidenceResultSchema, { observation, evidence, recordReference }, 'command evidence result'),
      stdout,
      stderr,
    };
  }
}

export async function recordCommandEvidence(
  store: StateStore,
  artifacts: ProtectedArtifactStore,
  resultValue: unknown
): Promise<void> {
  const result = parseBoundary(CommandEvidenceResultSchema, resultValue, 'command evidence journal input');
  const { observation, evidence, recordReference } = result;
  if (evidence.id !== observation.id || recordReference.journalReference !== evidence.id) {
    throw new CommandEvidenceError('Command observation, artifact, and evidence identifiers disagree');
  }
  if (
    evidence.origin !== 'controller_observed'
    || evidence.digest !== sha256Canonical(observation)
    || evidence.immutableReference !== `artifact:sha256:${recordReference.digest}`
    || recordReference.digest !== sha256Bytes(Buffer.from(canonicalJson(observation), 'utf8'))
  ) {
    throw new CommandEvidenceError('Command evidence digest or protected reference disagrees with trusted observation');
  }
  const recordBytes = await artifacts.read(recordReference);
  if (!recordBytes.equals(Buffer.from(canonicalJson(observation), 'utf8'))) {
    throw new CommandEvidenceError('Retained command observation bytes disagree at journal boundary');
  }
  for (const output of [observation.stdout, observation.stderr]) {
    if (output.retained === null) continue;
    if (
      output.retained.journalReference !== evidence.id
      || output.retained.digest !== output.digest
      || output.retained.byteCount !== output.byteCount
      || output.retained.mediaType !== output.mediaType
    ) {
      throw new CommandEvidenceError('Retained command output metadata disagrees at journal boundary');
    }
    await artifacts.read(output.retained);
  }
  await store.commit({ kind: 'evidence_recorded', evidence }, 'controller');
}
