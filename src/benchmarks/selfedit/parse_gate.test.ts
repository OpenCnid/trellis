import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkParseResults, parseGateLanguage } from './check';
import { gatherParseResults, parsePythonFile, parseTypeScriptSource } from './parse_gate';

// Session 37 (§5f): the parse gate fires on a planted syntax-broken
// fixture per wired language and stays silent on clean files and on
// extensions with no parser. The Python fixture replicates the EXACT
// Session 36 run-1 escape shape: a valid function body with the stale
// docstring tail left below it as dead bytes (unmatched ')').

// The same resolution the runtime config uses (src/config/index.ts),
// without importing the config module into the unit suite — the
// block_parity.test.ts mold; CI installs Python before npm test.
const PYTHON =
  process.env.PYTHON_EXECUTABLE
  ?? (process.platform === 'win32' ? 'python' : 'python3');

const RUN1_SHAPE_BROKEN_PY = [
  'def get_addresses():',
  '    """A COPY of the run\'s retrieved-address set (callers can never',
  '    mutate run state). Live on research runs."""',
  '    with _lock:',
  '        return set(_addresses)',
  "    mutate run state). Slice (d)'s future input.\"\"\"",
  '    with _lock:',
  '        return set(_addresses)',
  '',
].join('\n');

const CLEAN_PY = 'def f():\n    return 1\n';
const CLEAN_TS = 'export const answer: number = 42;\n';
const BROKEN_TS = 'export const answer: number = (42;\n';

let dir: string;

beforeAll(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'parse-gate-test-'));
  await fs.promises.writeFile(path.join(dir, 'broken.py'), RUN1_SHAPE_BROKEN_PY, 'utf-8');
  await fs.promises.writeFile(path.join(dir, 'clean.py'), CLEAN_PY, 'utf-8');
  await fs.promises.writeFile(path.join(dir, 'clean.ts'), CLEAN_TS, 'utf-8');
  await fs.promises.writeFile(path.join(dir, 'broken.ts'), BROKEN_TS, 'utf-8');
  await fs.promises.writeFile(path.join(dir, 'notes.md'), '# not parsed\n', 'utf-8');
});

afterAll(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true });
});

describe('parseGateLanguage', () => {
  it('maps exactly .py and .ts/.js; everything else is unchecked', () => {
    expect(parseGateLanguage('src/rlm/trellis_tools.py')).toBe('python');
    expect(parseGateLanguage('src/benchmarks/selfedit/check.ts')).toBe('typescript');
    expect(parseGateLanguage('scripts/thing.js')).toBe('typescript');
    expect(parseGateLanguage('README.md')).toBeNull();
    expect(parseGateLanguage('data/frankenstein.txt')).toBeNull();
  });
});

describe('parseTypeScriptSource', () => {
  it('returns null for clean source', () => {
    expect(parseTypeScriptSource('clean.ts', CLEAN_TS)).toBeNull();
  });

  it('reports a bounded diagnostic with a line number for broken source', () => {
    const error = parseTypeScriptSource('broken.ts', BROKEN_TS);
    expect(error).not.toBeNull();
    expect(error).toContain('line 1');
    expect((error as string).length).toBeLessThanOrEqual(220);
  });
});

describe('parsePythonFile', () => {
  it('returns null for a clean file', async () => {
    expect(await parsePythonFile(PYTHON, path.join(dir, 'clean.py'))).toBeNull();
  });

  it("flags the run-1 shape (dead docstring tail) as a SyntaxError", async () => {
    const error = await parsePythonFile(PYTHON, path.join(dir, 'broken.py'));
    expect(error).not.toBeNull();
    expect(error).toContain('SyntaxError');
    expect(error).toContain('line');
  });
});

describe('gatherParseResults + checkParseResults', () => {
  it('is silent on clean named files and unwired extensions', async () => {
    const results = await gatherParseResults(dir, ['clean.py', 'clean.ts', 'notes.md'], PYTHON);
    expect(results).toHaveLength(3);
    expect(results.find(r => r.file === 'notes.md')?.language).toBeNull();
    expect(checkParseResults(results)).toEqual([]);
  });

  it('flags each planted broken fixture with named_file_unparseable', async () => {
    const results = await gatherParseResults(dir, ['broken.py', 'broken.ts'], PYTHON);
    const findings = checkParseResults(results);
    expect(findings).toHaveLength(2);
    expect(findings.every(f => f.code === 'named_file_unparseable')).toBe(true);
    expect(findings[0].detail).toContain('broken.py');
    expect(findings[0].detail).toContain('SyntaxError');
    expect(findings[1].detail).toContain('broken.ts');
  });

  it('flags a named file missing under the edit root', async () => {
    const results = await gatherParseResults(dir, ['ghost.py'], PYTHON);
    const findings = checkParseResults(results);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('named_file_unparseable');
    expect(findings[0].detail).toContain('missing under the edit root');
  });
});
