import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DOMAIN_SCHEMA_VERSION, type Feature, type StateSnapshot } from '../src/domain';
import { canonicalJson, sha256Canonical } from '../src/events';
import {
  HANDOFF_RENDERER_VERSION,
  RendererError,
  deriveTrustedReport,
  renderHandoffPreviewBytes,
  renderReportBytes,
  renderStatusBytes,
} from '../src/handoff_renderer';
import { EL03_REQUIREMENT_EVIDENCE } from '../src/requirements';
import type { CommandEvidenceResult } from '../src/command_evidence';
import type { RepositoryStateObservation } from '../src/repo_observer';

const roots: string[] = [];
const NOW = '2026-07-14T15:00:00.000Z';
const EMPTY_DIGEST = createHash('sha256').update(Buffer.alloc(0)).digest('hex');

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const FEATURE: Feature = {
  id: 'feature:EL-03',
  schemaVersion: DOMAIN_SCHEMA_VERSION,
  createdAt: NOW,
  workflowId: 'workflow:engineering-loop',
  featureId: 'EL-03',
  order: 3,
  dependencies: ['EL-02'],
  scope: ['tools/engineering-loop'],
  artifacts: ['tools/engineering-loop/src', 'tools/engineering-loop/tests'],
  acceptanceCriteria: [{ id: 'EL-03-A1', kind: 'static', requirement: 'Repository facts are computed' }],
  gates: ['human_review'],
  paidWork: 'forbidden',
  definitionDigest: '4'.repeat(64),
};

function commandEvidence(id: string): CommandEvidenceResult {
  const observation = {
    id,
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    createdAt: NOW,
    workflowId: FEATURE.workflowId,
    featureId: FEATURE.featureId,
    sessionId: 'session:57',
    origin: 'controller_observed' as const,
    argv: ['npm', 'test'],
    cwd: '/fixture/worktree',
    startedAt: NOW,
    endedAt: NOW,
    exitCode: 0,
    signal: null,
    timedOut: false,
    cancelled: false,
    stdout: {
      byteCount: 0,
      digest: EMPTY_DIGEST,
      previewByteCount: 0,
      previewBase64: '',
      mediaType: 'text/plain',
      retained: null,
    },
    stderr: {
      byteCount: 0,
      digest: EMPTY_DIGEST,
      previewByteCount: 0,
      previewBase64: '',
      mediaType: 'text/plain',
      retained: null,
    },
  };
  const digest = sha256Canonical(observation);
  const recordReference = {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    digest,
    mediaType: 'application/vnd.trellis.engineering-loop.command-observation+json',
    byteCount: Buffer.byteLength(canonicalJson(observation)),
    relativePath: `artifacts/sha256/${digest.slice(0, 2)}/${digest}`,
    journalReference: id,
  };
  return {
    observation,
    recordReference,
    evidence: {
      id,
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      createdAt: NOW,
      workflowId: FEATURE.workflowId,
      featureId: FEATURE.featureId,
      sessionId: 'session:57',
      origin: 'controller_observed',
      observedAt: NOW,
      digest,
      immutableReference: `artifact:sha256:${digest}`,
      mediaType: recordReference.mediaType,
      byteCount: recordReference.byteCount,
      metadata: [],
    },
  };
}

const VERIFY_COMMAND = commandEvidence('evidence:verify:1');

const REPOSITORY: RepositoryStateObservation = {
  id: 'repository-observation:report',
  schemaVersion: DOMAIN_SCHEMA_VERSION,
  createdAt: NOW,
  origin: 'controller_observed',
  repositoryId: 'repository:fixture',
  worktreeId: 'worktree:fixture',
  repositoryRoot: '/fixture/worktree',
  worktreePath: '/fixture/worktree',
  gitCommonDir: '/fixture/common-git',
  branch: 'implement-el03-repository-observer',
  baseCommit: '1'.repeat(40),
  headCommit: '2'.repeat(40),
  clean: false,
  remote: {
    name: 'origin',
    url: 'https://github.com/OpenCnid/trellis.git',
    identity: 'github.com/opencnid/trellis',
  },
  allowedScopes: ['tools/engineering-loop'],
  changes: [{
    path: 'tools/engineering-loop/src/repo_observer.ts',
    originalPath: null,
    indexStatus: 'M',
    worktreeStatus: '.',
    staged: true,
    unstaged: false,
    untracked: false,
    deleted: false,
    renamed: false,
    conflicted: false,
  }],
  changedPaths: ['tools/engineering-loop/src/repo_observer.ts'],
  commandEvidenceIds: ['evidence:repo:1'],
};

const SNAPSHOT: StateSnapshot = {
  id: 'snapshot:el03-renderer',
  schemaVersion: DOMAIN_SCHEMA_VERSION,
  createdAt: NOW,
  workflowId: FEATURE.workflowId,
  featureId: FEATURE.featureId,
  sessionId: 'session:57',
  definitionDigest: FEATURE.definitionDigest,
  scopeDigest: sha256Canonical([...FEATURE.scope].sort()),
  expectedRepository: {
    repositoryId: REPOSITORY.repositoryId,
    worktreeId: REPOSITORY.worktreeId,
    branch: REPOSITORY.branch,
    baseCommit: REPOSITORY.baseCommit,
    headCommit: REPOSITORY.headCommit,
    clean: REPOSITORY.clean,
  },
  state: 'awaiting_review',
  resumeState: null,
  recoveryState: null,
  pendingProtectedAction: null,
  lastEventSequence: 12,
  lastEventDigest: '5'.repeat(64),
  evidenceIds: ['evidence:repo:1', VERIFY_COMMAND.evidence.id],
  approvalIds: [],
  consumedApprovalIds: [],
  intents: [],
  outcomes: [],
};

async function catalog(): Promise<unknown> {
  return JSON.parse(await readFile('docs/product/engineering-loop/features.json', 'utf8'));
}

/**
 * Status as the acceptance ledger resolves it, supplied here as a fixture.
 *
 * The renderer's job is deterministic rendering given status, not knowing the
 * truth, so the suite states status directly rather than reading protected
 * state. Post-migration the catalog carries none, so this fixture is now the
 * only status source the renderer sees.
 */
const FEATURE_STATUSES = {
  'EL-00': 'accepted', 'EL-01': 'accepted', 'EL-02': 'accepted', 'EL-03': 'accepted',
  'EL-04': 'accepted', 'EL-05': 'accepted', 'EL-06': 'accepted', 'EL-07': 'blocked',
  'EL-08': 'deferred', 'EL-09': 'deferred', 'EL-10': 'planned',
} as const;

async function report() {
  return deriveTrustedReport({
    reportId: 'report:session:57',
    createdAt: NOW,
    result: 'ready_for_owner_review',
    snapshot: SNAPSHOT,
    feature: FEATURE,
    repository: REPOSITORY,
    commandEvidence: [VERIFY_COMMAND],
    requirementEvidence: EL03_REQUIREMENT_EVIDENCE,
    findings: [{ source: 'controller', code: 'zero-paid', message: 'Zero model and paid calls observed.' }],
    catalog: await catalog(),
    featureStatuses: FEATURE_STATUSES,
  });
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('EL-03 trusted report and deterministic derived views', () => {
  it('derives exact normative report fields, engine counts, changed artifacts, verification, findings, and next feature', async () => {
    const derived = await report();
    expect(Object.keys(derived)).toEqual([
      'id', 'schemaVersion', 'createdAt', 'workflowId', 'featureId', 'sessionId',
      'feature', 'result', 'artifacts', 'normative_requirements', 'verification',
      'findings', 'next_feature',
    ]);
    expect(derived.normative_requirements).toEqual({ required: 12, implemented: 12, verified: 12, outstanding: [] });
    expect(derived.artifacts).toEqual(['tools/engineering-loop/src/repo_observer.ts']);
    expect(derived.verification[0].command).toBe('cwd="/fixture/worktree" argv=["npm","test"]');
    expect(derived.verification[0].result).toContain('exit=0 timeout=false cancelled=false');
    expect(derived.next_feature).toBe('EL-10');
  });

  it('refuses unjournaled or runner-reported command claims as verification truth', async () => {
    const unjournaled = { ...SNAPSHOT, evidenceIds: ['evidence:repo:1'] };
    await expect(Promise.resolve().then(async () => deriveTrustedReport({
      reportId: 'report:unjournaled', createdAt: NOW, result: 'blocked',
      snapshot: unjournaled, feature: FEATURE, repository: REPOSITORY,
      commandEvidence: [VERIFY_COMMAND], requirementEvidence: EL03_REQUIREMENT_EVIDENCE,
      findings: [], catalog: await catalog(), featureStatuses: FEATURE_STATUSES,
    }))).rejects.toThrow(/not journal-linked/);

    await expect(Promise.resolve().then(async () => deriveTrustedReport({
      reportId: 'report:runner-claim', createdAt: NOW, result: 'blocked',
      snapshot: SNAPSHOT, feature: FEATURE, repository: REPOSITORY,
      commandEvidence: [{
        ...VERIFY_COMMAND,
        evidence: { ...VERIFY_COMMAND.evidence, origin: 'runner_reported' },
      }],
      requirementEvidence: EL03_REQUIREMENT_EVIDENCE,
      findings: [], catalog: await catalog(), featureStatuses: FEATURE_STATUSES,
    }))).rejects.toThrow();
  });

  it('refuses nonzero, timed-out, or cancelled command evidence in a ready-for-review report', async () => {
    for (const observation of [
      { ...VERIFY_COMMAND.observation, exitCode: 2 },
      { ...VERIFY_COMMAND.observation, exitCode: null, signal: 'SIGTERM', timedOut: true },
      { ...VERIFY_COMMAND.observation, exitCode: null, signal: 'SIGTERM', cancelled: true },
    ]) {
      const digestValue = sha256Canonical(observation);
      const result = {
        ...VERIFY_COMMAND,
        observation,
        evidence: {
          ...VERIFY_COMMAND.evidence,
          digest: digestValue,
          immutableReference: `artifact:sha256:${digestValue}`,
        },
        recordReference: {
          ...VERIFY_COMMAND.recordReference,
          digest: digestValue,
          relativePath: `artifacts/sha256/${digestValue.slice(0, 2)}/${digestValue}`,
        },
      };
      await expect(Promise.resolve().then(async () => deriveTrustedReport({
        reportId: 'report:refused-command', createdAt: NOW, result: 'ready_for_owner_review',
        snapshot: SNAPSHOT, feature: FEATURE, repository: REPOSITORY,
        commandEvidence: [result], requirementEvidence: EL03_REQUIREMENT_EVIDENCE,
        findings: [], catalog: await catalog(), featureStatuses: FEATURE_STATUSES,
      }))).rejects.toThrow(/requires successful/);
    }
  });

  it('computes outstanding IDs rather than accepting supplied requirement counts', async () => {
    const incomplete = EL03_REQUIREMENT_EVIDENCE.map((item, index) => (
      index === 0 ? { ...item, tests: [] } : item
    ));
    const derived = deriveTrustedReport({
      reportId: 'report:outstanding', createdAt: NOW, result: 'blocked',
      snapshot: SNAPSHOT, feature: FEATURE, repository: REPOSITORY,
      commandEvidence: [VERIFY_COMMAND], requirementEvidence: incomplete,
      findings: [], catalog: await catalog(), featureStatuses: FEATURE_STATUSES,
    });
    expect(derived.normative_requirements).toEqual({
      required: 12,
      implemented: 12,
      verified: 11,
      outstanding: ['EL-REQ-DATA-006'],
    });
  });

  it('renders byte-identical report, status, and handoff preview pins from identical canonical input', async () => {
    const derived = await report();
    const reportBytes = renderReportBytes(derived);
    const statusBytes = renderStatusBytes({
      rendererVersion: HANDOFF_RENDERER_VERSION,
      snapshot: SNAPSHOT,
      repository: REPOSITORY,
      report: derived,
    });
    const previewInput = {
      rendererVersion: HANDOFF_RENDERER_VERSION,
      report: derived,
      repository: REPOSITORY,
      nextFeatureOutcome: 'Only independent evidence and explicit authority can advance implementation toward completion.',
      evidenceReferences: [VERIFY_COMMAND.recordReference],
      archiveReferences: ['docs/archive/ROADMAP_HISTORY.md#engineering-loop'],
    };
    const previewBytes = renderHandoffPreviewBytes(previewInput);
    expect(renderReportBytes(structuredClone(derived))).toEqual(reportBytes);
    expect(renderStatusBytes({ rendererVersion: HANDOFF_RENDERER_VERSION, snapshot: structuredClone(SNAPSHOT), repository: structuredClone(REPOSITORY), report: structuredClone(derived) })).toEqual(statusBytes);
    expect(renderHandoffPreviewBytes(structuredClone(previewInput))).toEqual(previewBytes);
    expect({ report: digest(reportBytes), status: digest(statusBytes), handoff: digest(previewBytes) }).toEqual({
      report: 'c329941dec4e79ed70ce4ef95256bd21a61bcfb135e1a16abcb1cb4b124a6c6b',
      status: '63646e346d337f517920106af78c818230e44ce310c66356c5e1eaea398b53b4',
      handoff: '8e5af95b6e4e502ed703843d4bbecc1c02e8b598ef06bdf8550eea7ea5ac5fd0',
    });
  });

  it('renders by reference without copying journal, transcript, diff, command output, or roadmap history', async () => {
    const derived = await report();
    const preview = renderHandoffPreviewBytes({
      rendererVersion: HANDOFF_RENDERER_VERSION,
      report: derived,
      repository: REPOSITORY,
      nextFeatureOutcome: 'Bounded next-feature outcome.',
      evidenceReferences: [VERIFY_COMMAND.recordReference],
      archiveReferences: ['archive:roadmap-history'],
    }).toString();
    expect(preview).toContain('Preview only');
    expect(preview).toContain(VERIFY_COMMAND.recordReference.digest);
    expect(preview).not.toContain('all tests passed');
    expect(preview).not.toContain('events.jsonl');
    expect(preview).not.toContain('full transcript');
    expect(preview).not.toContain('diff --git');
  });

  it('is pure and leaves manual HANDOFF.md plus external bytes unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trellis-el03-render-purity-'));
    roots.push(root);
    const manualHandoff = join(root, 'HANDOFF.md');
    const protectedState = join(root, 'snapshot.json');
    await writeFile(manualHandoff, 'manual authority\n');
    await writeFile(protectedState, '{"trusted":true}\n');
    const beforeInputs = canonicalJson({ snapshot: SNAPSHOT, repository: REPOSITORY });
    const beforeHandoff = await readFile(manualHandoff);
    const beforeState = await readFile(protectedState);
    const derived = await report();
    renderReportBytes(derived);
    renderStatusBytes({ rendererVersion: HANDOFF_RENDERER_VERSION, snapshot: SNAPSHOT, repository: REPOSITORY, report: derived });
    renderHandoffPreviewBytes({
      rendererVersion: HANDOFF_RENDERER_VERSION,
      report: derived,
      repository: REPOSITORY,
      nextFeatureOutcome: null,
      evidenceReferences: [],
      archiveReferences: [],
    });
    expect(canonicalJson({ snapshot: SNAPSHOT, repository: REPOSITORY })).toBe(beforeInputs);
    expect(await readFile(manualHandoff)).toEqual(beforeHandoff);
    expect(await readFile(protectedState)).toEqual(beforeState);
  });

  it('refuses unsupported renderer versions and over-bound context collections', async () => {
    const derived = await report();
    expect(() => renderStatusBytes({
      rendererVersion: 'handoff-renderer:v2' as typeof HANDOFF_RENDERER_VERSION,
      snapshot: SNAPSHOT,
      repository: REPOSITORY,
      report: derived,
    })).toThrow(RendererError);
    expect(() => renderHandoffPreviewBytes({
      rendererVersion: HANDOFF_RENDERER_VERSION,
      report: derived,
      repository: REPOSITORY,
      nextFeatureOutcome: null,
      evidenceReferences: Array.from({ length: 65 }, () => VERIFY_COMMAND.recordReference),
      archiveReferences: [],
    })).toThrow();
  });
});
