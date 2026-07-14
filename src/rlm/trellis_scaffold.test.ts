// Session 50: unit pins for the RLM harness scaffolds
// (docs/architecture/RLM_HARNESS_SCAFFOLDING.md — the S1 uuid wrapper +
// trellis_task surface and the S3 staged helpers). The battery runs in
// ONE spawned python process (scripts/test_scaffold_unit.py) because
// trellis_scaffold.py and trellis_textedit.py are stdlib-only on
// purpose (the block_parity precedent) — plain `npm test` needs no
// database runtime. The citability probe's database half is drilled
// live by test:rlm-sandbox section [8].
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import * as path from 'path';

// The same resolution the runtime config uses (src/config/index.ts),
// without importing the config module into the unit suite.
const PYTHON =
  process.env.PYTHON_EXECUTABLE
  ?? (process.platform === 'win32' ? 'python' : 'python3');

function runBattery(): Record<string, unknown> {
  const result = spawnSync(
    PYTHON,
    [path.resolve('scripts', 'test_scaffold_unit.py'), path.resolve('src', 'rlm')],
    { encoding: 'utf-8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `scaffold unit battery failed (exit ${result.status}): ${result.stderr}`
    );
  }
  const line = result.stdout.trim().split('\n').pop();
  return JSON.parse(line ?? '{}');
}

const R = runBattery();

function allRaised(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string' && v.length > 0);
}

describe('S1: wrap_task_text (the uuid wrapper)', () => {
  it('wraps the task in matching uuid tags on their own lines', () => {
    expect(R.wrap).toBe('<rlm_usercontext-abc-123>\nTASK BODY\n</rlm_usercontext-abc-123>');
  });

  it('refuses empty text, blank/braced uuids, and non-strings', () => {
    expect(allRaised(R.wrap_refusals)).toBe(true);
  });
});

describe('S1: the trellis_task surface', () => {
  it('text() returns the operator task verbatim (braces and CR intact)', () => {
    expect(R.task_text_verbatim).toBe(true);
  });

  it('exposes the run uuid for in-code provenance checks', () => {
    expect(R.task_uuid).toBe('uuid-1');
  });

  it('refuses empty task text and empty uuids at construction', () => {
    expect(allRaised(R.task_refusals)).toBe(true);
  });

  it('grep() returns bounded structured hits with untruncated line text', () => {
    const g = R.grep as { totalHits: number; capped: boolean; hits: { line: number; text: string }[] };
    expect(g.totalHits).toBe(1);
    expect(g.capped).toBe(false);
    expect(g.hits).toEqual([{ line: 1, text: 'RULE: braces {stay} verbatim\r' }]);
  });

  it('grep() caps hits at the kernel constant and reports the true total', () => {
    const c = R.grep_cap as { total: number; returned: number; capped: boolean; max: number };
    expect(c.returned).toBe(c.max);
    expect(c.total).toBe(c.max + 10);
    expect(c.capped).toBe(true);
  });

  it('grep() refuses an invalid regex and an empty pattern', () => {
    expect(typeof R.grep_invalid_regex).toBe('string');
    expect(typeof R.grep_empty_pattern).toBe('string');
  });
});

describe('parse_task_named_files (the driver input)', () => {
  it('unset, blank, and the explicit empty array all mean "no probe"', () => {
    expect(R.ptnf_unset).toBe(true);
    expect(R.ptnf_blank).toBe(true);
    expect(R.ptnf_empty_array).toBe(true);
  });

  it('normalizes backslashes and drops duplicates, order-preserving', () => {
    expect(R.ptnf_valid).toEqual(['src/config/index.ts', 'src/config/rlm_backend.test.ts']);
  });

  it('refuses malformed JSON, non-arrays, >16 entries, non-strings, oversize entries', () => {
    expect(allRaised(R.ptnf_refusals)).toBe(true);
  });
});

describe('S3: frame helpers over a real toolkit', () => {
  it('frame_text is byte-identical to the file for LF and CRLF frames', () => {
    expect(R.frame_text_lf).toBe(true);
    expect(R.frame_text_crlf).toBe(true);
  });

  it('an unloaded file gets the toolkit "No held frame" teaching refusal', () => {
    expect(String(R.frame_text_unloaded)).toContain('No held frame');
  });

  it('region_lines returns the half-open slice as a list of line texts', () => {
    expect(R.region_lines).toEqual(['beta', 'gamma']);
  });

  it('region_lines refuses out-of-range and non-integer addresses', () => {
    expect(String(R.region_lines_out_of_range)).toContain('invalid');
    expect(typeof R.region_lines_bad_index).toBe('string');
  });

  it('region_equal byte-compares lists (CR retained on CRLF frames)', () => {
    expect(R.region_equal_true_crlf).toBe(true);
    expect(R.region_equal_false).toBe(false);
  });

  it('region_equal refuses newline-bearing entries and empty lists', () => {
    expect(typeof R.region_equal_newline_refused).toBe('string');
    expect(typeof R.region_equal_empty_refused).toBe('string');
  });

  it('concat_files joins held frames into one buffer string', () => {
    expect(R.concat).toBe('alpha\nbeta\ngamma\n\none\r\ntwo\r\nthree');
  });

  it('concat_files refuses unloaded members and empty lists', () => {
    expect(String(R.concat_unloaded)).toContain('No held frame');
    expect(typeof R.concat_bad_arg).toBe('string');
  });

  it('helpers read the WORKING frame: staged splices are visible', () => {
    expect(R.frame_text_staged).toBe(true);
    expect(R.region_equal_staged).toBe(true);
  });
});

describe('S3: gating (the build_mcp_addendum precedent)', () => {
  it('bare construction injects nothing', () => {
    expect(R.gate_bare).toBe(true);
  });

  it('a toolkit alone injects exactly the four frame helpers', () => {
    expect(R.gate_textedit_only).toEqual(['concat_files', 'frame_text', 'region_equal', 'region_lines']);
  });

  it('named files without a postgres surface inject nothing', () => {
    expect(R.gate_named_files_without_postgres).toEqual([]);
  });

  it('named files + database surfaces inject exactly the probe', () => {
    expect(R.gate_citable_only).toEqual(['citable']);
  });

  it('everything configured injects all five helpers', () => {
    expect(R.gate_everything).toEqual(['citable', 'concat_files', 'frame_text', 'region_equal', 'region_lines']);
  });
});

describe('S3: the conditional addenda', () => {
  it('gated-off compositions are the empty string (byte-identical prompt)', () => {
    expect(R.addenda_off_empty).toBe(true);
  });

  it('gated-on compositions are exactly the kernel constants', () => {
    expect(R.addenda_on).toBe(true);
  });

  it('both addenda are brace-free (rlms .format() safety)', () => {
    expect(R.addenda_brace_free).toBe(true);
  });
});
