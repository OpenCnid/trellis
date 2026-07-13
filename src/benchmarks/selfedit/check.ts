// Session 35 (REPOSITORY_INGESTION_REPORT.md §5e): the stage-2
// self-edit checker — pure evaluation of the named failure mode
// "graph-misdirected editing" (the run touched a file the graph
// evidence did not name, or edited on the basis of contested
// beliefs). All I/O lives in scripts/stage2_selfedit_check.ts and the
// drill; these functions take gathered state and return typed
// findings so every detection branch is unit-pinnable.
//
// HONEST SCOPE (§5e.2): the evidence check proves the RECORDED
// evidence chain — the derived insight the run wrote, whose cited
// hashes the Session 31 write gate already constrained to in-run
// retrievals. It does not prove every byte the run read, and it does
// not prove query-before-edit ordering; the run transcript carries
// that, and the human review reads it.

export type SelfEditFindingCode =
  | 'out_of_scope_edit'
  | 'named_file_unchanged'
  | 'evidence_edge_missing'
  | 'empty_evidence'
  | 'contested_evidence'
  | 'dead_evidence_hash'
  | 'unbridged_evidence'
  | 'target_entity_missing'
  | 'contested_target'
  | 'doc_missing';

export interface SelfEditFinding {
  code: SelfEditFindingCode;
  detail: string;
}

/** The run's recorded evidence edge, as gathered from Neo4j. */
export interface EvidenceEdge {
  found: boolean;
  subjectContested: boolean;
  objectContested: boolean;
  edgeContested: boolean;
  sourceNodeIds: string[];
}

/** Per cited hash: existence and current-version document membership. */
export interface HashEvidence {
  hash: string;
  existsInAstNodes: boolean;
  /** doc_keys whose CURRENT version's root contains this hash. */
  liveDocKeys: string[];
}

export interface SelfEditRunEvidence {
  /** Paths changed under the edit root (parseGitStatusPorcelain). */
  changedPaths: string[];
  /** Repo-relative paths the task named as editable. */
  namedFiles: string[];
  /** Doc-key prefix that maps a named file to its substrate document,
   *  e.g. 'repo:trellis:'. */
  docKeyPrefix: string;
  edge: EvidenceEdge;
  hashes: HashEvidence[];
}

/** Pre-run state for the refresh-before-use check (§5e.2 item 3). */
export interface SelfEditPreState {
  /** Target entity name -> found/contested state; a missing entity is
   *  {found:false, ...}. */
  entities: { name: string; found: boolean; contested: boolean; contestedEdges: number }[];
  /** Named file -> whether its substrate document exists. */
  docs: { namedFile: string; docKey: string; present: boolean }[];
}

/**
 * Parses `git status --porcelain` (v1) output into changed paths.
 * Renames contribute both sides; quoted paths are unquoted (bounded:
 * surrounding quotes stripped, no escape decoding beyond that);
 * backslashes normalize to forward slashes.
 */
export function parseGitStatusPorcelain(output: string): string[] {
  const paths: string[] = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') continue;
    // Two status columns + one separator space.
    const rest = line.slice(3);
    const parts = rest.includes(' -> ') ? rest.split(' -> ') : [rest];
    for (const part of parts) {
      let p = part.trim();
      if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
        p = p.slice(1, -1);
      }
      p = p.replace(/\\/g, '/');
      if (p !== '') paths.push(p);
    }
  }
  return paths;
}

/**
 * Scope check: exactly the named files changed. Any extra path is an
 * out-of-scope edit; a named file with no change means the run never
 * made the edit it was asked for.
 */
export function checkEditScope(changedPaths: string[], namedFiles: string[]): SelfEditFinding[] {
  const findings: SelfEditFinding[] = [];
  const named = new Set(namedFiles.map(f => f.replace(/\\/g, '/')));
  const changed = new Set(changedPaths.map(f => f.replace(/\\/g, '/')));
  for (const p of changed) {
    if (!named.has(p)) {
      findings.push({ code: 'out_of_scope_edit', detail: `changed path not named by the task: ${p}` });
    }
  }
  for (const f of named) {
    if (!changed.has(f)) {
      findings.push({ code: 'named_file_unchanged', detail: `named file has no change: ${f}` });
    }
  }
  return findings;
}

/**
 * Evidence check: the recorded insight edge exists, nothing in its
 * chain is contested, and every cited hash is live in the CURRENT
 * version of a substrate document that bridges to a named file.
 */
export function checkEvidence(evidence: SelfEditRunEvidence): SelfEditFinding[] {
  const findings: SelfEditFinding[] = [];
  const { edge, hashes, namedFiles, docKeyPrefix } = evidence;
  if (!edge.found) {
    findings.push({ code: 'evidence_edge_missing', detail: 'the run recorded no derived insight for the task' });
    return findings;
  }
  if (edge.sourceNodeIds.length === 0) {
    findings.push({ code: 'empty_evidence', detail: 'the evidence edge carries no sourceNodeIds' });
  }
  if (edge.edgeContested) {
    findings.push({ code: 'contested_evidence', detail: 'the evidence edge is contested' });
  }
  if (edge.subjectContested) {
    findings.push({ code: 'contested_evidence', detail: 'the evidence subject entity is contested' });
  }
  if (edge.objectContested) {
    findings.push({ code: 'contested_evidence', detail: 'the evidence object entity is contested' });
  }
  const namedDocKeys = new Set(namedFiles.map(f => docKeyPrefix + f.replace(/\\/g, '/')));
  for (const h of hashes) {
    const shortHash = `${h.hash.slice(0, 12)}…`;
    if (!h.existsInAstNodes) {
      findings.push({ code: 'dead_evidence_hash', detail: `cited hash not in ast_nodes: ${shortHash}` });
      continue;
    }
    if (h.liveDocKeys.length === 0) {
      findings.push({
        code: 'dead_evidence_hash',
        detail: `cited hash is not a member of any document's current version: ${shortHash}`,
      });
      continue;
    }
    if (!h.liveDocKeys.some(k => namedDocKeys.has(k))) {
      findings.push({
        code: 'unbridged_evidence',
        detail: `cited hash bridges only to unnamed documents (${h.liveDocKeys.slice(0, 3).join(', ')}): ${shortHash}`,
      });
    }
  }
  return findings;
}

/** The full post-run evaluation: scope + evidence. */
export function evaluateSelfEditRun(evidence: SelfEditRunEvidence): SelfEditFinding[] {
  return [...checkEditScope(evidence.changedPaths, evidence.namedFiles), ...checkEvidence(evidence)];
}

/**
 * Pre-run check (refresh-before-use): the target entities exist and
 * nothing in their neighborhood is contested, and the named files'
 * substrate documents are present. An edit premised on quarantined
 * beliefs is refused before any spend.
 */
export function evaluatePreCheck(state: SelfEditPreState): SelfEditFinding[] {
  const findings: SelfEditFinding[] = [];
  for (const e of state.entities) {
    if (!e.found) {
      findings.push({ code: 'target_entity_missing', detail: `target entity not in the graph: ${e.name}` });
      continue;
    }
    if (e.contested) {
      findings.push({ code: 'contested_target', detail: `target entity is contested: ${e.name}` });
    }
    if (e.contestedEdges > 0) {
      findings.push({
        code: 'contested_target',
        detail: `${e.contestedEdges} contested ACTION edge(s) attached to ${e.name}`,
      });
    }
  }
  for (const d of state.docs) {
    if (!d.present) {
      findings.push({ code: 'doc_missing', detail: `substrate document absent for ${d.namedFile}: ${d.docKey}` });
    }
  }
  return findings;
}
