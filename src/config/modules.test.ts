import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MODULE_SELECTION,
  MODULE_RUBRIC_TOKEN,
  listModuleNames,
  loadModule,
  loadModules,
  parseModuleSelection,
  readModuleManifest,
  serializeModuleSelection,
} from './modules';

// Session 15 (design record §9): the module registry validator. The
// Python twin (src/rlm/trellis_modules.py) carries identical bounds;
// the cross-language pin lives in npm run test:modules.

describe('parseModuleSelection', () => {
  it('defaults to module #0 when unset (byte-identical composed prompt)', () => {
    expect(parseModuleSelection(undefined)).toEqual([...DEFAULT_MODULE_SELECTION]);
  });

  it('accepts an explicit selection and the empty selection', () => {
    expect(parseModuleSelection('["spatial-flywheel"]')).toEqual(['spatial-flywheel']);
    expect(parseModuleSelection('[]')).toEqual([]);
  });

  it('round-trips through the canonical serialization', () => {
    const selection = parseModuleSelection('["spatial-flywheel"]');
    expect(parseModuleSelection(serializeModuleSelection(selection))).toEqual(selection);
  });

  it('rejects malformed JSON, non-arrays, bad names, duplicates, and beyond-cap selections', () => {
    expect(() => parseModuleSelection('{oops')).toThrow(/not valid JSON/);
    expect(() => parseModuleSelection('"spatial-flywheel"')).toThrow(/JSON array/);
    for (const bad of ['["Spatial-Flywheel"]', '["1digit"]', '["has space"]', '["br{ace}"]', '[42]']) {
      expect(() => parseModuleSelection(bad)).toThrow(/module name/);
    }
    expect(() => parseModuleSelection('["a","a"]')).toThrow(/duplicate/);
    expect(() => parseModuleSelection('["a","b","c","d","e"]')).toThrow(/at most 4/);
  });
});

describe('loadModule (the committed registry)', () => {
  it('loads module #0 with a brace-free addendum carrying the rubric token', () => {
    const module = loadModule('spatial-flywheel');
    expect(module.name).toBe('spatial-flywheel');
    expect(module.version).toBe(1);
    expect(module.addendumText).toContain('SPATIAL FLYWHEEL PROTOCOL');
    expect(module.addendumText).toContain(MODULE_RUBRIC_TOKEN);
    expect(module.addendumText).not.toMatch(/[{}]/);
    // LF-normalized regardless of checkout convention.
    expect(module.addendumText).not.toContain('\r');
  });

  it('loads the default selection end-to-end', () => {
    const modules = loadModules(parseModuleSelection(undefined));
    expect(modules.map(m => m.name)).toEqual([...DEFAULT_MODULE_SELECTION]);
  });
});

describe('loadModule (defect rejection)', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeModule(manifest: Record<string, unknown>, addendum: string | null): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-modules-'));
    const dir = path.join(tmpDir, String(manifest.name ?? 'testmod'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'module.json'), JSON.stringify(manifest));
    if (addendum !== null) {
      fs.writeFileSync(path.join(dir, 'addendum.txt'), addendum);
    }
    return tmpDir;
  }

  const VALID = {
    name: 'testmod',
    version: 1,
    purpose: 'A test module.',
    research: { sourceNodeIds: [] },
    addendum: 'addendum.txt',
    tools: [],
    bounds: { addendumMaxBytes: 1024 },
    acceptance: { zeroPaid: 'npm run test:module -- testmod' },
    status: 'active',
    kernelCompat: 1,
  };

  // Name and criterion move together, so the directory-name check is what
  // fires below and not the acceptance guard sitting beside it.
  const RENAMED = {
    ...VALID,
    name: 'othername',
    acceptance: { zeroPaid: 'npm run test:module -- othername' },
  };

  it('accepts a minimal valid protocol module', () => {
    const dir = writeModule(VALID, 'PROTOCOL TEXT\n');
    expect(loadModule('testmod', dir).addendumText).toBe('PROTOCOL TEXT\n');
  });

  it('normalizes CRLF addenda to LF (byte-stable composition)', () => {
    const dir = writeModule(VALID, 'LINE ONE\r\nLINE TWO\r\n');
    expect(loadModule('testmod', dir).addendumText).toBe('LINE ONE\nLINE TWO\n');
  });

  it('rejects an unregistered module', () => {
    const dir = writeModule(VALID, 'x\n');
    expect(() => loadModule('ghost', dir)).toThrow(/not registered/);
  });

  it('rejects a manifest whose name differs from its directory', () => {
    const dir = writeModule(RENAMED, 'x\n');
    fs.renameSync(path.join(dir, 'othername'), path.join(dir, 'testmod'));
    expect(() => loadModule('testmod', dir)).toThrow(/must equal its directory name/);
  });

  it('rejects tool-bearing modules (not this kernel edition)', () => {
    const dir = writeModule({ ...VALID, tools: ['web_search'] }, 'x\n');
    expect(() => loadModule('testmod', dir)).toThrow(/invalid/);
  });

  it('rejects contested and retired modules from composition', () => {
    for (const status of ['contested', 'retired']) {
      const dir = writeModule({ ...VALID, status }, 'x\n');
      expect(() => loadModule('testmod', dir)).toThrow(/only active modules load/);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readModuleManifest reads a contested manifest that composition refuses (Session 18 registration seam)', () => {
    const dir = writeModule({ ...VALID, status: 'contested' }, 'x\n');
    expect(readModuleManifest('testmod', dir).status).toBe('contested');
    expect(() => loadModule('testmod', dir)).toThrow(/only active modules load/);
  });

  it('readModuleManifest still enforces manifest shape and directory-name identity', () => {
    const dir = writeModule({ ...VALID, hotPatch: true }, 'x\n');
    expect(() => readModuleManifest('testmod', dir)).toThrow(/invalid/);
    fs.rmSync(dir, { recursive: true, force: true });
    const dir2 = writeModule(RENAMED, 'x\n');
    fs.renameSync(path.join(dir2, 'othername'), path.join(dir2, 'testmod'));
    expect(() => readModuleManifest('testmod', dir2)).toThrow(/must equal its directory name/);
  });

  it('listModuleNames returns sorted module.json-bearing directories only', () => {
    const dir = writeModule(VALID, 'x\n');
    fs.mkdirSync(path.join(dir, 'zz-not-a-module'));
    fs.mkdirSync(path.join(dir, 'another'));
    fs.writeFileSync(path.join(dir, 'another', 'module.json'), '{}');
    expect(listModuleNames(dir)).toEqual(['another', 'testmod']);
    expect(listModuleNames(path.join(dir, 'no-such-dir'))).toEqual([]);
  });

  it('rejects a kernelCompat mismatch', () => {
    const dir = writeModule({ ...VALID, kernelCompat: 2 }, 'x\n');
    expect(() => loadModule('testmod', dir)).toThrow(/invalid/);
  });

  it('rejects a missing addendum file', () => {
    const dir = writeModule(VALID, null);
    expect(() => loadModule('testmod', dir)).toThrow(/addendum file/);
  });

  it('rejects an addendum beyond its size bound', () => {
    const dir = writeModule(VALID, 'x'.repeat(2048));
    expect(() => loadModule('testmod', dir)).toThrow(/addendumMaxBytes/);
  });

  it('rejects literal braces in the addendum (rlms .format() contract)', () => {
    const dir = writeModule(VALID, 'text with {braces}\n');
    expect(() => loadModule('testmod', dir)).toThrow(/literal braces/);
  });

  it('rejects addendum paths that escape the module directory', () => {
    for (const escape of ['../evil.txt', 'sub/evil.txt', 'sub\\evil.txt']) {
      const dir = writeModule({ ...VALID, addendum: escape }, 'x\n');
      expect(() => loadModule('testmod', dir)).toThrow(/invalid/);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects manifests with unknown fields (strict schema)', () => {
    const dir = writeModule({ ...VALID, hotPatch: true }, 'x\n');
    expect(() => loadModule('testmod', dir)).toThrow(/invalid/);
  });

  it('accepts a zeroPaid criterion that names its own module, and surfaces it', () => {
    const dir = writeModule(VALID, 'x\n');
    expect(readModuleManifest('testmod', dir).acceptance.zeroPaid).toBe(
      'npm run test:module -- testmod'
    );
  });

  it('rejects a manifest with no acceptance criterion at all (no longer optional)', () => {
    const { acceptance: _omitted, ...noAcceptance } = VALID;
    const dir = writeModule(noAcceptance, 'x\n');
    expect(() => readModuleManifest('testmod', dir)).toThrow(/invalid/);
    expect(() => readModuleManifest('testmod', dir)).toThrow(/acceptance/);
  });

  it('rejects a zeroPaid criterion that does not name its module (the shared-criterion defect)', () => {
    const dir = writeModule(
      { ...VALID, acceptance: { zeroPaid: 'npm run test:modules' } },
      'x\n'
    );
    expect(() => readModuleManifest('testmod', dir)).toThrow(
      /acceptance\.zeroPaid must name the module it accepts/
    );
    // The operator is told the module, the canonical form, and what they wrote.
    expect(() => readModuleManifest('testmod', dir)).toThrow(
      /expected a command containing 'testmod' \(canonical: "npm run test:module -- testmod"\), got "npm run test:modules"/
    );
    // Composition refuses it too — the guard is not registration-only.
    expect(() => loadModule('testmod', dir)).toThrow(/must name the module it accepts/);
  });

  it('rejects a zeroPaid criterion naming a DIFFERENT module (criteria do not travel on copy-paste)', () => {
    const dir = writeModule(
      { ...VALID, acceptance: { zeroPaid: 'npm run test:module -- spatial-flywheel' } },
      'x\n'
    );
    expect(() => loadModule('testmod', dir)).toThrow(/must name the module it accepts/);
  });

  it('rejects an empty zeroPaid string (the sub-schema bound still holds)', () => {
    const dir = writeModule({ ...VALID, acceptance: { zeroPaid: '' } }, 'x\n');
    expect(() => readModuleManifest('testmod', dir)).toThrow(/invalid/);
  });

  it('rejects research provenance that is not AST-hash shaped', () => {
    const dir = writeModule(
      { ...VALID, research: { sourceNodeIds: ['q_0001'] } },
      'x\n'
    );
    expect(() => loadModule('testmod', dir)).toThrow(/invalid/);
  });
});
