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
  | 'doc_missing'
  | 'named_file_unparseable'
  | 'named_file_noncomment_change';

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

/** The full post-run evaluation: scope + evidence. The parse gate
 *  (Session 37) composes ADDITIVELY beside this in the CLI — this
 *  function's contract and the Session 35 pins over it are unchanged. */
export function evaluateSelfEditRun(evidence: SelfEditRunEvidence): SelfEditFinding[] {
  return [...checkEditScope(evidence.changedPaths, evidence.namedFiles), ...checkEvidence(evidence)];
}

// --- The parse gate (Session 37, §5f) --------------------------------
// Post-run mechanical check: a self-edit that leaves a named file
// unparseable is a typed finding, not a human catch (the Session 36
// run-1 escape). Pure evaluation here; the file reads and interpreter
// spawn live in parse_gate.ts.

export type ParseGateLanguage = 'python' | 'typescript';

export interface FileParseResult {
  file: string;
  /** null = no parser wired for this extension; never a finding. */
  language: ParseGateLanguage | null;
  parseable: boolean;
  /** Bounded one-line parse error when !parseable. */
  error?: string;
}

/** Extension -> parser mapping. Exactly .py and .ts/.js this edition;
 *  anything else is honestly unchecked (language null). */
export function parseGateLanguage(file: string): ParseGateLanguage | null {
  const lower = file.toLowerCase();
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.ts') || lower.endsWith('.js')) return 'typescript';
  return null;
}

/** A named file with a wired parser that does not parse is a finding;
 *  unwired extensions never flag (the gate reports what it checked). */
export function checkParseResults(results: FileParseResult[]): SelfEditFinding[] {
  const findings: SelfEditFinding[] = [];
  for (const r of results) {
    if (r.language !== null && !r.parseable) {
      findings.push({
        code: 'named_file_unparseable',
        detail: `named file does not parse (${r.language}): ${r.file} — ${r.error ?? 'no parser detail'}`,
      });
    }
  }
  return findings;
}

// --- The comment-class diff gate (Session 39, §5g) --------------------
// Post-run mechanical check for increments DECLARED comment-class: every
// changed content line in the named file's diff — the removed side AND
// the added side — must be blank or a line comment for the file's
// language. The Session 37 run-2 escape (a splice that replaced a
// comment window with hand-retyped comment lines and dropped an
// executable neighbor, leaving a file that still PARSES) is mechanically
// decidable from the diff alone: the dropped executable line appears as
// a non-comment removed line. Never a write gate (guardrail 5's mold);
// evaluated ONLY for files the increment declared comment-class — an
// executable-class increment never sees it. Line comments only this
// edition (# for .py, // for .ts/.js); block-comment interiors and
// docstrings are OUT of scope, so a comment-class edit touching them
// flags conservatively (recorded honestly in §5g). The diff gatherer
// (read-only `git diff -- <file>`) lives in the CLI beside the
// git-status gatherer.

export interface DiffChangedLine {
  side: 'removed' | 'added';
  /** Line content without the leading -/+ marker. */
  text: string;
}

/**
 * Extracts changed content lines from unified diff text. Only in-hunk
 * -/+ lines contribute: file headers (diff --git, index, ---/+++, mode
 * lines) precede the first @@ and are skipped, context lines carry no
 * change, and the "\ No newline at end of file" marker is ignored.
 * Trailing CR is stripped. Bounded to the structure `git diff` actually
 * emits — not a general patch parser.
 */
export function parseUnifiedDiffChangedLines(diffText: string): DiffChangedLine[] {
  const changed: DiffChangedLine[] = [];
  let inHunk = false;
  for (const rawLine of diffText.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      continue;
    }
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('\\')) continue;
    if (line.startsWith('-')) changed.push({ side: 'removed', text: line.slice(1) });
    else if (line.startsWith('+')) changed.push({ side: 'added', text: line.slice(1) });
  }
  return changed;
}

const COMMENT_LINE_MARKERS: Record<ParseGateLanguage, string> = {
  python: '#',
  typescript: '//',
};

/**
 * Line-comment marker for a declared comment-class file; null when no
 * comment syntax is wired for the extension. The CLI REFUSES a
 * comment-class declaration whose file has no wired marker before any
 * I/O — a declared gate that silently checks nothing would be worse
 * than no gate.
 */
export function commentMarkerForFile(file: string): string | null {
  const language = parseGateLanguage(file);
  return language === null ? null : COMMENT_LINE_MARKERS[language];
}

/** Bound carried into finding details; keep refusal-style short. */
const CHANGED_LINE_DETAIL_MAX_CHARS = 120;

/**
 * Every changed line in a comment-class file's diff must be blank or a
 * line comment; anything else — either side — is a typed finding. The
 * Session 37 run-2 removed executable line is the reference violation.
 */
export function checkCommentClassDiff(
  file: string,
  marker: string,
  changedLines: DiffChangedLine[]
): SelfEditFinding[] {
  const findings: SelfEditFinding[] = [];
  for (const line of changedLines) {
    const trimmed = line.text.trim();
    if (trimmed === '' || trimmed.startsWith(marker)) continue;
    const shown =
      trimmed.length > CHANGED_LINE_DETAIL_MAX_CHARS
        ? `${trimmed.slice(0, CHANGED_LINE_DETAIL_MAX_CHARS)}…`
        : trimmed;
    findings.push({
      code: 'named_file_noncomment_change',
      detail: `comment-class file has a non-comment ${line.side} line: ${file} — "${shown}"`,
    });
  }
  return findings;
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
