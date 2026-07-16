import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AcceptanceLedger,
  AcceptanceRecordSchema,
  LEDGER_BREACH_REASONS,
  LEDGER_CEREMONIES,
  LedgerIntegrityError,
  LedgerRecordSchema,
  MAX_LEDGER_RECORDS,
  PROGRAM_ACCEPTANCE_WORKFLOW_ID,
  SPEC_DISJOINT_CEREMONIES,
  admissibleLedgerCeremonies,
  catalogProvenanceNotes,
  ledgerCeremonyAdmitted,
  ledgerRecordDigest,
  parseLedgerGeneration,
  resolveFeatureStatus,
  serializeLedgerRecord,
  type LedgerRecord,
} from '../src/acceptance_ledger';
import { GENESIS_DIGEST } from '../src/domain';
import { WriterLock } from '../src/writer_lock';

const NOW = '2026-07-15T12:00:00.000Z';
const CATALOG_DIGEST = 'a'.repeat(64);
const REQUEST_DIGEST = 'b'.repeat(64);

const temporary: string[] = [];

afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

async function roots(): Promise<{ ledgerRoot: string; worktree: string }> {
  const base = await mkdtemp(join(tmpdir(), 'trellis-el10-ledger-'));
  temporary.push(base);
  const ledgerRoot = join(base, 'protected', 'ledger');
  const worktree = join(base, 'worktree');
  await mkdir(worktree, { recursive: true });
  return { ledgerRoot, worktree };
}

function acceptance(sequence: number, featureId: string, status: LedgerRecord['kind'] extends never ? never : 'planned' | 'active' | 'accepted' | 'blocked' | 'deferred', previousDigest: string): LedgerRecord {
  return AcceptanceRecordSchema.parse({
    kind: 'acceptance',
    id: `acceptance:${featureId}:${sequence}`,
    schemaVersion: 1,
    sequence,
    previousDigest,
    createdAt: NOW,
    actor: 'human',
    approvalId: 'approval:seed',
    requestDigest: REQUEST_DIGEST,
    featureId,
    status,
    catalogDigest: CATALOG_DIGEST,
  });
}

function chain(pairs: ReadonlyArray<[string, 'planned' | 'accepted' | 'blocked' | 'deferred' | 'active']>): LedgerRecord[] {
  const records: LedgerRecord[] = [];
  let previousDigest = GENESIS_DIGEST;
  pairs.forEach(([featureId, status], index) => {
    const record = acceptance(index, featureId, status, previousDigest);
    records.push(record);
    previousDigest = ledgerRecordDigest(record);
  });
  return records;
}

function text(records: readonly LedgerRecord[]): string {
  return records.map(serializeLedgerRecord).join('');
}

async function open(ledgerRoot: string, worktree: string): Promise<AcceptanceLedger> {
  return AcceptanceLedger.open({
    ledgerRoot,
    worktree,
    clock: { now: () => NOW },
    ownerId: 'owner:test',
    ownerToken: 'token-0123456789abcdef',
  });
}

describe('EL-10 acceptance ledger', () => {
  it('acceptance_ledger: append-only monotonic chain', async () => {
    const { ledgerRoot, worktree } = await roots();
    const ledger = await open(ledgerRoot, worktree);
    try {
      const first = chain([['EL-00', 'accepted']]);
      await ledger.appendAll(0, first);
      const beforeBytes = await readFile(ledger.generationPath(0), 'utf8');

      const previousDigest = ledgerRecordDigest(first[0]);
      await ledger.appendAll(0, [acceptance(1, 'EL-01', 'accepted', previousDigest)]);
      const afterBytes = await readFile(ledger.generationPath(0), 'utf8');

      // Append-only is a byte-level property, not a convention: the prior bytes
      // survive verbatim as a prefix.
      expect(afterBytes.startsWith(beforeBytes)).toBe(true);
      const state = await ledger.readGeneration(0);
      expect(state.integrity).toBe('valid');
      expect(state.records.map(record => record.sequence)).toEqual([0, 1]);
      expect(state.records[1].previousDigest).toBe(ledgerRecordDigest(state.records[0]));
    } finally {
      await ledger.close();
    }
  });

  it('acceptance_ledger: a crashed append leaves no temp file that blocks the retry', async () => {
    const { ledgerRoot, worktree } = await roots();
    const ledger = await open(ledgerRoot, worktree);
    try {
      const records = chain([['EL-00', 'accepted']]);
      // Simulate a crash between the temp write and the atomic rename: the
      // temp file survives, the generation is still empty. The retry must not
      // be permanently blocked by the debris, because clearing it by hand would
      // mean a human editing the protected root — exactly what the recovery
      // ceremonies exist to avoid.
      await mkdir(join(ledgerRoot, 'generations', '0'), { recursive: true });
      await writeFile(`${ledger.generationPath(0)}.1.tmp`, 'debris from a crashed append', 'utf8');

      const applied = await ledger.appendAll(0, records);
      expect(applied.records).toHaveLength(1);
      expect(applied.integrity).toBe('valid');
      expect(resolveFeatureStatus(await ledger.readGeneration(0)).acceptedFeatureIds).toEqual(['EL-00']);
    } finally {
      await ledger.close();
    }
  });

  it('acceptance_ledger: refuses an append that does not link or sequence', async () => {
    const { ledgerRoot, worktree } = await roots();
    const ledger = await open(ledgerRoot, worktree);
    try {
      await expect(ledger.appendAll(0, [acceptance(1, 'EL-00', 'accepted', GENESIS_DIGEST)]))
        .rejects.toThrow(/expected sequence 0/);
      await expect(ledger.appendAll(0, [acceptance(0, 'EL-00', 'accepted', 'c'.repeat(64))]))
        .rejects.toThrow(/does not link to the preceding record/);
      await expect(ledger.appendAll(0, [])).rejects.toThrow(/at least one record/);
    } finally {
      await ledger.close();
    }
  });

  it('acceptance_ledger: status resolves from the ledger', () => {
    const records = chain([
      ['EL-00', 'accepted'], ['EL-06', 'accepted'], ['EL-07', 'blocked'],
      ['EL-08', 'deferred'], ['EL-10', 'planned'],
    ]);
    const resolved = resolveFeatureStatus(parseLedgerGeneration(0, text(records)));
    expect(resolved.acceptedFeatureIds).toEqual(['EL-00', 'EL-06']);
    expect(resolved.statuses.get('EL-07')).toBe('blocked');
    expect(resolved.statuses.get('EL-10')).toBe('planned');
    expect(resolved.recordCount).toBe(5);
    expect(resolved.consumedApprovalIds).toEqual(['approval:seed']);
  });

  it('acceptance_ledger: the last record naming a feature is current', () => {
    const records = chain([['EL-07', 'blocked'], ['EL-07', 'planned']]);
    const resolved = resolveFeatureStatus(parseLedgerGeneration(0, text(records)));
    expect(resolved.statuses.get('EL-07')).toBe('planned');
    // Supersession never mutates: both records survive in the chain.
    expect(resolved.recordCount).toBe(2);
  });

  it('acceptance_ledger: integrity refusal matrix', () => {
    const records = chain([['EL-00', 'accepted'], ['EL-01', 'accepted']]);
    const valid = text(records);

    // 1. Truncated final line.
    const truncated = parseLedgerGeneration(0, valid.slice(0, valid.length - 1));
    expect(truncated.integrity).toBe('broken');
    expect(truncated.breach?.reason).toBe('partial_append');

    // 2. Missing sequence: drop the first record, leaving sequence 1 at index 0.
    const missing = parseLedgerGeneration(0, `${serializeLedgerRecord(records[1])}`);
    expect(missing.integrity).toBe('broken');
    expect(missing.breach?.reason).toBe('missing_sequence');

    // 3. Digest mismatch: a content edit that keeps the schema and sequence valid
    //    but breaks the successor's link.
    const tampered = { ...records[0], status: 'planned' } as LedgerRecord;
    const mismatch = parseLedgerGeneration(0, `${serializeLedgerRecord(tampered)}${serializeLedgerRecord(records[1])}`);
    expect(mismatch.integrity).toBe('broken');
    expect(mismatch.breach?.reason).toBe('digest_mismatch');
    expect(mismatch.breach?.expectedDigest).toBe(ledgerRecordDigest(tampered));
    expect(mismatch.breach?.observedDigest).toBe(records[1].previousDigest);

    // 4. Invalid schema.
    expect(parseLedgerGeneration(0, '{"kind":"acceptance"}\n').breach?.reason).toBe('invalid_schema');
    expect(parseLedgerGeneration(0, 'not json\n').breach?.reason).toBe('invalid_schema');
    expect(parseLedgerGeneration(0, `${valid}\n`).breach?.reason).toBe('invalid_schema');

    expect(new Set(LEDGER_BREACH_REASONS)).toEqual(
      new Set(['missing_sequence', 'digest_mismatch', 'invalid_schema', 'partial_append'])
    );
  });

  it('acceptance_ledger: a broken chain stops resolution with no silent repair', () => {
    const records = chain([['EL-00', 'accepted'], ['EL-01', 'accepted']]);
    const broken = parseLedgerGeneration(0, serializeLedgerRecord(records[1]));
    expect(() => resolveFeatureStatus(broken)).toThrow(LedgerIntegrityError);
    // Nothing partial is returned: resolution stops rather than reporting the
    // records it managed to read.
    expect(broken.records).toEqual([]);
  });

  it('acceptance_ledger: refuses an append onto a broken chain', async () => {
    const { ledgerRoot, worktree } = await roots();
    const ledger = await open(ledgerRoot, worktree);
    try {
      const records = chain([['EL-00', 'accepted'], ['EL-01', 'accepted']]);
      await mkdir(join(ledgerRoot, 'generations', '0'), { recursive: true });
      await writeFile(ledger.generationPath(0), serializeLedgerRecord(records[1]), 'utf8');
      await expect(ledger.appendAll(0, [acceptance(0, 'EL-02', 'accepted', GENESIS_DIGEST)]))
        .rejects.toThrow(LedgerIntegrityError);
    } finally {
      await ledger.close();
    }
  });

  it('acceptance_ledger: rejects a record whose actor is not human', () => {
    for (const actor of ['controller', 'model', 'runner', 'checker']) {
      expect(LedgerRecordSchema.safeParse({
        ...chain([['EL-00', 'accepted']])[0], actor,
      }).success).toBe(false);
    }
  });

  it('acceptance_ledger: strict schema refuses unknown fields and unbounded records', () => {
    const [record] = chain([['EL-00', 'accepted']]);
    expect(LedgerRecordSchema.safeParse({ ...record, extra: 1 }).success).toBe(false);
    expect(LedgerRecordSchema.safeParse({ ...record, status: 'invented' }).success).toBe(false);
    expect(LedgerRecordSchema.safeParse({ ...record, sequence: -1 }).success).toBe(false);
    expect(LedgerRecordSchema.safeParse({ ...record, previousDigest: 'short' }).success).toBe(false);
    expect(MAX_LEDGER_RECORDS).toBe(1_024);
  });

  it('acceptance_ledger: ceremony predicates are disjoint and total', async () => {
    const { ledgerRoot, worktree } = await roots();
    const ledger = await open(ledgerRoot, worktree);
    try {
      const empty = await ledger.readGeneration(0);
      expect(admissibleLedgerCeremonies(empty)).toEqual(['seeding']);

      const records = chain([['EL-00', 'accepted']]);
      await ledger.appendAll(0, records);
      const populated = await ledger.readGeneration(0);
      // A healthy populated generation admits two ceremonies, not one. Reporting
      // `ledger_recovery` alone is what left the ledger write-once: the only
      // ceremony an owner was told they could run on a working ledger was the one
      // for corruption.
      expect(admissibleLedgerCeremonies(populated)).toEqual(['steady_state_acceptance', 'ledger_recovery']);

      const brokenState = parseLedgerGeneration(0, serializeLedgerRecord(chain([['EL-00', 'accepted'], ['EL-01', 'accepted']])[1]));
      expect(admissibleLedgerCeremonies(brokenState)).toEqual(['re_genesis']);

      expect(LEDGER_CEREMONIES).toEqual(['seeding', 'steady_state_acceptance', 'ledger_recovery', 're_genesis']);

      // Totality: every reachable generation state admits at least one ceremony,
      // so no state is a dead end with no route out. That property is what the
      // paired-recovery amendment (9.9) exists to hold.
      const states = [empty, populated, brokenState];
      for (const state of states) {
        expect(admissibleLedgerCeremonies(state).length, JSON.stringify(state.integrity)).toBeGreaterThan(0);
      }

      // Disjointness, mechanically: the three ceremonies SPEC 6.1 declares keep
      // predicates no state satisfies two of. `steady_state_acceptance` shares
      // `ledger_recovery`'s state by design and is told apart by action identity
      // and record kind, never by a mode flag, so it is excluded here by name
      // rather than by omission.
      for (const state of states) {
        const admitted = admissibleLedgerCeremonies(state)
          .filter(ceremony => (SPEC_DISJOINT_CEREMONIES as readonly string[]).includes(ceremony));
        expect(admitted).toHaveLength(1);
      }
      expect(SPEC_DISJOINT_CEREMONIES).toEqual(['seeding', 'ledger_recovery', 're_genesis']);
      expect(ledgerCeremonyAdmitted(populated, 'steady_state_acceptance')).toBe(true);
      expect(ledgerCeremonyAdmitted(populated, 'seeding')).toBe(false);
      expect(ledgerCeremonyAdmitted(empty, 'steady_state_acceptance')).toBe(false);
      expect(ledgerCeremonyAdmitted(brokenState, 'steady_state_acceptance')).toBe(false);
    } finally {
      await ledger.close();
    }
  });

  it('acceptance_ledger: reuses the path-scoped writer lock without contending with a workflow root', async () => {
    const { ledgerRoot, worktree } = await roots();
    const ledger = await open(ledgerRoot, worktree);
    try {
      const record = await WriterLock.inspect(join(ledger.root, '.writer.lock'));
      expect(record.workflowId).toBe(PROGRAM_ACCEPTANCE_WORKFLOW_ID);
      // A second writer on the same root is refused without mutating state.
      await expect(open(ledgerRoot, worktree)).rejects.toThrow(/writer lock already exists/);
    } finally {
      await ledger.close();
    }
  });

  it('acceptance_ledger: a read-only handle inspects under a held lock and cannot write', async () => {
    const { ledgerRoot, worktree } = await roots();
    const writer = await open(ledgerRoot, worktree);
    try {
      await writer.appendAll(0, chain([['EL-00', 'accepted']]));

      // The writer lock is still held. Inspection must still work: `status` is
      // exactly what an operator reaches for when the ledger is stuck or locked.
      const reader = await AcceptanceLedger.openReadOnly({
        ledgerRoot, worktree, clock: { now: () => NOW },
      });
      expect(reader.readOnly).toBe(true);
      const state = await reader.readCurrentGeneration();
      expect(state.integrity).toBe('valid');
      expect(resolveFeatureStatus(state).acceptedFeatureIds).toEqual(['EL-00']);

      // But it is read-only in fact, not just by name.
      await expect(reader.appendAll(0, chain([['EL-01', 'accepted']])))
        .rejects.toThrow(/Read-only ledger handle cannot append/);
      await reader.close();
    } finally {
      await writer.close();
    }
  });

  it('acceptance_ledger: the current-generation pointer never moves backwards', async () => {
    const { ledgerRoot, worktree } = await roots();
    const ledger = await open(ledgerRoot, worktree);
    try {
      await ledger.appendAll(1, chain([['EL-00', 'accepted']]));
      expect(await ledger.currentGeneration()).toBe(1);
      await expect(ledger.appendAll(0, chain([['EL-01', 'accepted']])))
        .rejects.toThrow(/would move the current pointer back from 1/);
      expect(await ledger.currentGeneration()).toBe(1);
    } finally {
      await ledger.close();
    }
  });

  it('acceptance_ledger: refuses a root inside the assigned worktree', async () => {
    const { worktree } = await roots();
    await expect(open(join(worktree, 'ledger'), worktree)).rejects.toThrow(/must not be inside the assigned worktree/);
  });

  it('acceptance_ledger: reports catalog digest drift as provenance rather than refusing it', () => {
    const resolved = resolveFeatureStatus(parseLedgerGeneration(0, text(chain([['EL-00', 'accepted']]))));
    expect(catalogProvenanceNotes(resolved, CATALOG_DIGEST)).toEqual([]);
    const notes = catalogProvenanceNotes(resolved, 'f'.repeat(64));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('recorded for provenance, not enforced');
  });

  it('acceptance_ledger: consumed approvals are derived from replay across generations', async () => {
    const { ledgerRoot, worktree } = await roots();
    const ledger = await open(ledgerRoot, worktree);
    try {
      await ledger.appendAll(0, chain([['EL-00', 'accepted']]));
      expect(await ledger.consumedApprovalIds()).toEqual(['approval:seed']);
      expect(await ledger.currentGeneration()).toBe(0);
    } finally {
      await ledger.close();
    }
  });
});
