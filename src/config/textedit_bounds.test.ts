import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Session 20: editing-toolkit configuration is validated with hard
// maxima (the workspace_bounds.test.ts discipline), and the edit root —
// the operator-owned enablement switch — fails fast at startup when it
// is not an existing directory (the credential-resolution precedent).
// The Python half (src/rlm/trellis_textedit.py) re-validates the bounds
// with the same defaults and caps; the cross-language pin lives in
// test:textedit.

const TEXTEDIT_KEYS = [
  'TRELLIS_EDIT_ROOT',
  'TRELLIS_TEXTEDIT_MAX_FILE_BYTES',
  'TRELLIS_TEXTEDIT_MAX_FILES',
] as const;

const saved = new Map<string, string | undefined>();

function setEnv(overrides: Partial<Record<(typeof TEXTEDIT_KEYS)[number], string>>): void {
  for (const key of TEXTEDIT_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function loadConfig() {
  vi.resetModules();
  const module = await import('./index');
  return module.config;
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  vi.resetModules();
});

describe('textedit configuration', () => {
  it('defaults to toolkit OFF with 4 MiB / 16-file bounds', async () => {
    setEnv({});
    const config = await loadConfig();
    expect(config.textedit).toEqual({
      editRoot: undefined,
      maxFileBytes: 4 * 1024 * 1024,
      maxFiles: 16,
    });
  });

  it('treats a blank edit root as unset (toolkit stays off)', async () => {
    setEnv({ TRELLIS_EDIT_ROOT: '   ' });
    const config = await loadConfig();
    expect(config.textedit.editRoot).toBeUndefined();
  });

  it('accepts an existing directory as the edit root', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'trellis-editroot-'));
    try {
      setEnv({ TRELLIS_EDIT_ROOT: root });
      const config = await loadConfig();
      expect(config.textedit.editRoot).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast when the edit root does not exist or is a file', async () => {
    setEnv({ TRELLIS_EDIT_ROOT: path.join(tmpdir(), 'trellis-no-such-dir-xyz') });
    await expect(loadConfig()).rejects.toThrow(/Invalid TRELLIS_EDIT_ROOT/);

    setEnv({ TRELLIS_EDIT_ROOT: path.resolve('package.json') });
    await expect(loadConfig()).rejects.toThrow(/Invalid TRELLIS_EDIT_ROOT/);
  });

  it('accepts explicit bounds inside the hard caps', async () => {
    setEnv({
      TRELLIS_TEXTEDIT_MAX_FILE_BYTES: String(32 * 1024 * 1024),
      TRELLIS_TEXTEDIT_MAX_FILES: '64',
    });
    const config = await loadConfig();
    expect(config.textedit.maxFileBytes).toBe(32 * 1024 * 1024);
    expect(config.textedit.maxFiles).toBe(64);
  });

  it('rejects zero, negative, fractional, and beyond-cap bounds', async () => {
    for (const bad of [
      { TRELLIS_TEXTEDIT_MAX_FILES: '0' },
      { TRELLIS_TEXTEDIT_MAX_FILES: '65' },
      { TRELLIS_TEXTEDIT_MAX_FILES: '2.5' },
      { TRELLIS_TEXTEDIT_MAX_FILE_BYTES: '-1' },
      { TRELLIS_TEXTEDIT_MAX_FILE_BYTES: String(32 * 1024 * 1024 + 1) },
      { TRELLIS_TEXTEDIT_MAX_FILE_BYTES: 'huge' },
    ] as const) {
      setEnv(bad);
      await expect(loadConfig()).rejects.toThrow(/Invalid environment configuration/);
    }
  });
});
