import { describe, expect, it } from 'vitest';
import {
  checkCommentClassDiff,
  checkEditScope,
  checkEvidence,
  checkParseResults,
  commentMarkerForFile,
  evaluatePreCheck,
  evaluateSelfEditRun,
  FileParseResult,
  parseGitStatusPorcelain,
  parseUnifiedDiffChangedLines,
  SelfEditRunEvidence,
} from './check';

// Session 35 (§5e): every detection branch of the stage-2 self-edit
// checker fires on its planted violation and stays silent on clean
// input. The live drill (test:selfedit-harness) re-proves the same
// codes end to end against real databases; these pins make each
// branch deletion-detectable offline.

const H = (n: number) => n.toString(16).padStart(64, '0');

function cleanEvidence(): SelfEditRunEvidence {
  return {
    changedPaths: ['src/rlm/trellis_tools.py'],
    namedFiles: ['src/rlm/trellis_tools.py'],
    docKeyPrefix: 'repo:trellis:',
    edge: {
      found: true,
      subjectContested: false,
      objectContested: false,
      edgeContested: false,
      sourceNodeIds: [H(1), H(2)],
    },
    hashes: [
      { hash: H(1), existsInAstNodes: true, liveDocKeys: ['repo:trellis:src/rlm/trellis_tools.py'] },
      { hash: H(2), existsInAstNodes: true, liveDocKeys: ['repo:trellis:src/rlm/trellis_tools.py'] },
    ],
  };
}

describe('parseGitStatusPorcelain', () => {
  it('parses modified and untracked entries', () => {
    expect(parseGitStatusPorcelain(' M src/rlm/trellis_tools.py\n?? stray.txt\n')).toEqual([
      'src/rlm/trellis_tools.py',
      'stray.txt',
    ]);
  });

  it('contributes both sides of a rename and unquotes quoted paths', () => {
    expect(parseGitStatusPorcelain('R  "old name.txt" -> "new name.txt"')).toEqual([
      'old name.txt',
      'new name.txt',
    ]);
  });

  it('normalizes backslashes and ignores blank lines', () => {
    expect(parseGitStatusPorcelain(' M src\\rlm\\trellis_tools.py\r\n\n')).toEqual([
      'src/rlm/trellis_tools.py',
    ]);
  });

  it('returns empty for empty output', () => {
    expect(parseGitStatusPorcelain('')).toEqual([]);
  });
});

describe('checkEditScope', () => {
  it('passes when exactly the named file changed', () => {
    expect(checkEditScope(['a.py'], ['a.py'])).toEqual([]);
  });

  it('flags an out-of-scope edit', () => {
    const findings = checkEditScope(['a.py', 'b.py'], ['a.py']);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('out_of_scope_edit');
    expect(findings[0].detail).toContain('b.py');
  });

  it('flags a named file with no change', () => {
    const findings = checkEditScope([], ['a.py']);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('named_file_unchanged');
  });

  it('treats separator style as equal', () => {
    expect(checkEditScope(['src\\a.py'], ['src/a.py'])).toEqual([]);
  });
});

describe('checkEvidence', () => {
  it('passes on clean evidence', () => {
    expect(checkEvidence(cleanEvidence())).toEqual([]);
  });

  it('flags a missing evidence edge and stops there', () => {
    const e = cleanEvidence();
    e.edge.found = false;
    const findings = checkEvidence(e);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('evidence_edge_missing');
  });

  it('flags empty sourceNodeIds', () => {
    const e = cleanEvidence();
    e.edge.sourceNodeIds = [];
    e.hashes = [];
    expect(checkEvidence(e).map(f => f.code)).toContain('empty_evidence');
  });

  it('flags a contested edge, subject, and object independently', () => {
    const e = cleanEvidence();
    e.edge.edgeContested = true;
    e.edge.subjectContested = true;
    e.edge.objectContested = true;
    const codes = checkEvidence(e).map(f => f.code);
    expect(codes.filter(c => c === 'contested_evidence')).toHaveLength(3);
  });

  it('flags a hash absent from ast_nodes as dead', () => {
    const e = cleanEvidence();
    e.hashes[1] = { hash: H(2), existsInAstNodes: false, liveDocKeys: [] };
    const findings = checkEvidence(e);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('dead_evidence_hash');
    expect(findings[0].detail).toContain('not in ast_nodes');
  });

  it('flags a superseded hash (no current-version membership) as dead', () => {
    const e = cleanEvidence();
    e.hashes[1] = { hash: H(2), existsInAstNodes: true, liveDocKeys: [] };
    const findings = checkEvidence(e);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('dead_evidence_hash');
    expect(findings[0].detail).toContain('current version');
  });

  it('flags a live hash bridging only to unnamed documents', () => {
    const e = cleanEvidence();
    e.hashes[1] = { hash: H(2), existsInAstNodes: true, liveDocKeys: ['repo:trellis:src/other.py'] };
    const findings = checkEvidence(e);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('unbridged_evidence');
    expect(findings[0].detail).toContain('src/other.py');
  });
});

describe('evaluateSelfEditRun', () => {
  it('combines scope and evidence findings', () => {
    const e = cleanEvidence();
    e.changedPaths.push('stray.txt');
    e.edge.edgeContested = true;
    const codes = evaluateSelfEditRun(e).map(f => f.code);
    expect(codes).toContain('out_of_scope_edit');
    expect(codes).toContain('contested_evidence');
  });

  it('is clean end to end on clean input', () => {
    expect(evaluateSelfEditRun(cleanEvidence())).toEqual([]);
  });
});

describe('checkParseResults', () => {
  const parses = (file: string, language: FileParseResult['language']): FileParseResult => ({
    file,
    language,
    parseable: true,
  });

  it('is silent when every wired file parses', () => {
    expect(
      checkParseResults([parses('a.py', 'python'), parses('b.ts', 'typescript'), parses('c.md', null)])
    ).toEqual([]);
  });

  it('flags an unparseable named file with the bounded error detail', () => {
    const findings = checkParseResults([
      { file: 'a.py', language: 'python', parseable: false, error: "SyntaxError: unmatched ')' (line 95)" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('named_file_unparseable');
    expect(findings[0].detail).toContain('a.py');
    expect(findings[0].detail).toContain("unmatched ')'");
  });

  it('never flags an extension with no parser wired, even marked unparseable', () => {
    expect(checkParseResults([{ file: 'c.md', language: null, parseable: false }])).toEqual([]);
  });
});

// Session 39 (§5g): the comment-class diff gate. The reference
// violation is the EXACT preserved Session 37 run-2 failed diff
// (benchmark_logs/session37_run2_failed_diff.patch, reproduced inline
// below): a comment splice whose hand-retyped window dropped the
// executable "retrieved_addresses" line and the Session 33 comment
// head — the file still parses, so only this gate can see it.
const RUN2_FAILED_DIFF = [
  'diff --git a/src/rlm/trellis_agent.py b/src/rlm/trellis_agent.py',
  'index 6ba03cf..af6bca0 100644',
  '--- a/src/rlm/trellis_agent.py',
  '+++ b/src/rlm/trellis_agent.py',
  '@@ -574,10 +574,10 @@ def main():',
  '             "answer_submits": get_answer_submit_count(),',
  '             # Session 30 (PROVENANCE_THREADING.md slice b): the size of',
  "             # the run's retrieved-address set — a count only, never the",
  '-            # addresses (T16). Bookkeeping; slice (d) will constrain',
  '-            # citable addresses to the set itself.',
  '-            "retrieved_addresses": get_retrieved_address_count(),',
  '-            # Session 33 (RETRIEVAL_DISCIPLINE.md §6): retrieval-',
  '+            # addresses (T16). Bookkeeping; slice (d) is live: this',
  '+            # file wires get_retrieved_addresses into the write gate',
  '+            # through the retrieved_addresses_check constructor seam on',
  '+            # research runs.',
  '             # discipline activity — counts only, never an identity',
  '             # (T16). The Node scanner tolerates unknown fields (pinned).',
  '             **get_retrieval_discipline_stats(),',
].join('\n');

describe('parseUnifiedDiffChangedLines', () => {
  it('extracts exactly the -/+ lines of the run-2 diff, headers and context skipped', () => {
    const lines = parseUnifiedDiffChangedLines(RUN2_FAILED_DIFF);
    expect(lines).toHaveLength(8);
    expect(lines.filter(l => l.side === 'removed')).toHaveLength(4);
    expect(lines.filter(l => l.side === 'added')).toHaveLength(4);
    expect(lines.map(l => l.text)).toContain(
      '            "retrieved_addresses": get_retrieved_address_count(),'
    );
    // The ---/+++ file headers are NOT changed lines.
    expect(lines.some(l => l.text.startsWith('-- a/'))).toBe(false);
    expect(lines.some(l => l.text.startsWith('++ b/'))).toBe(false);
  });

  it('ignores the no-newline marker and tolerates CRLF', () => {
    const diff = [
      'diff --git a/x.py b/x.py',
      '--- a/x.py\r',
      '+++ b/x.py\r',
      '@@ -1 +1 @@\r',
      '-# old\r',
      '+# new\r',
      '\\ No newline at end of file\r',
    ].join('\n');
    expect(parseUnifiedDiffChangedLines(diff)).toEqual([
      { side: 'removed', text: '# old' },
      { side: 'added', text: '# new' },
    ]);
  });

  it('handles an in-hunk removed line that itself starts with dashes', () => {
    const diff = ['@@ -1 +1 @@', '--- not a header, a removed line', '+# fine'].join('\n');
    const lines = parseUnifiedDiffChangedLines(diff);
    expect(lines[0]).toEqual({ side: 'removed', text: '-- not a header, a removed line' });
  });

  it('resets hunk state on a new file section', () => {
    const diff = [
      '@@ -1 +1 @@',
      '-# a',
      'diff --git a/y.py b/y.py',
      '--- a/y.py',
      '+++ b/y.py',
      '@@ -1 +1 @@',
      '+# b',
    ].join('\n');
    expect(parseUnifiedDiffChangedLines(diff)).toEqual([
      { side: 'removed', text: '# a' },
      { side: 'added', text: '# b' },
    ]);
  });

  it('returns empty for an empty diff', () => {
    expect(parseUnifiedDiffChangedLines('')).toEqual([]);
  });
});

describe('commentMarkerForFile', () => {
  it('wires # for python and // for typescript/javascript', () => {
    expect(commentMarkerForFile('a.py')).toBe('#');
    expect(commentMarkerForFile('b.ts')).toBe('//');
    expect(commentMarkerForFile('c.js')).toBe('//');
  });

  it('returns null for unwired extensions', () => {
    expect(commentMarkerForFile('notes.txt')).toBeNull();
    expect(commentMarkerForFile('README.md')).toBeNull();
  });
});

describe('checkCommentClassDiff', () => {
  it('fires on the run-2 shape: the removed executable line, exactly once', () => {
    const lines = parseUnifiedDiffChangedLines(RUN2_FAILED_DIFF);
    const findings = checkCommentClassDiff('src/rlm/trellis_agent.py', '#', lines);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('named_file_noncomment_change');
    expect(findings[0].detail).toContain('removed');
    expect(findings[0].detail).toContain('retrieved_addresses');
  });

  it('is silent on a comment-only edit with blank lines', () => {
    const findings = checkCommentClassDiff('a.py', '#', [
      { side: 'removed', text: '  # stale sentence' },
      { side: 'added', text: '  # corrected sentence' },
      { side: 'added', text: '   ' },
    ]);
    expect(findings).toEqual([]);
  });

  it('fires on an ADDED executable line too', () => {
    const findings = checkCommentClassDiff('a.py', '#', [
      { side: 'added', text: 'x = 1  # trailing comment does not save it' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('named_file_noncomment_change');
    expect(findings[0].detail).toContain('added');
  });

  it('respects the language marker (// for typescript)', () => {
    expect(
      checkCommentClassDiff('a.ts', '//', [{ side: 'removed', text: '  // old note' }])
    ).toEqual([]);
    const findings = checkCommentClassDiff('a.ts', '//', [
      { side: 'removed', text: '  # not a ts comment' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('bounds the quoted line in the detail', () => {
    const long = `const x = '${'y'.repeat(300)}';`;
    const findings = checkCommentClassDiff('a.ts', '//', [{ side: 'added', text: long }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail.length).toBeLessThan(250);
    expect(findings[0].detail).toContain('…');
  });

  it('is silent on an empty diff (unchanged declared file)', () => {
    expect(checkCommentClassDiff('a.py', '#', [])).toEqual([]);
  });
});

describe('evaluatePreCheck', () => {
  const cleanPre = () => ({
    entities: [{ name: 'get_retrieved_addresses', found: true, contested: false, contestedEdges: 0 }],
    docs: [
      {
        namedFile: 'src/rlm/trellis_tools.py',
        docKey: 'repo:trellis:src/rlm/trellis_tools.py',
        present: true,
      },
    ],
  });

  it('passes on clean pre-run state', () => {
    expect(evaluatePreCheck(cleanPre())).toEqual([]);
  });

  it('flags a missing target entity', () => {
    const s = cleanPre();
    s.entities[0].found = false;
    expect(evaluatePreCheck(s).map(f => f.code)).toEqual(['target_entity_missing']);
  });

  it('flags a contested target and contested attached edges', () => {
    const s = cleanPre();
    s.entities[0].contested = true;
    s.entities[0].contestedEdges = 2;
    const codes = evaluatePreCheck(s).map(f => f.code);
    expect(codes.filter(c => c === 'contested_target')).toHaveLength(2);
  });

  it('flags a missing substrate document', () => {
    const s = cleanPre();
    s.docs[0].present = false;
    const findings = evaluatePreCheck(s);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('doc_missing');
    expect(findings[0].detail).toContain('repo:trellis:src/rlm/trellis_tools.py');
  });
});
