import { describe, expect, it } from 'vitest';
import {
  checkEditScope,
  checkEvidence,
  checkParseResults,
  evaluatePreCheck,
  evaluateSelfEditRun,
  FileParseResult,
  parseGitStatusPorcelain,
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
