import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterAll } from 'vitest';
import {
  MODULE_ARM_ENV_VAR,
  probeModulesJson,
  resolveProbeModuleSelection,
} from './module_arm';

// Session 28: the probe module-arm flag (TRELLIS_EXP_MODULES). The two
// load-bearing pins: unset composes exactly the probe's historical
// spawn-env bytes, and a set value crosses the ORDINARY registry
// validation (shape + existence + active status) before any spawn.

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A minimal registry fixture with one module in the given status. */
function fixtureRegistry(status: 'active' | 'contested'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-module-arm-'));
  tempDirs.push(dir);
  const moduleDir = path.join(dir, 'fixture-module');
  fs.mkdirSync(moduleDir);
  fs.writeFileSync(
    path.join(moduleDir, 'module.json'),
    JSON.stringify({
      name: 'fixture-module',
      version: 1,
      purpose: 'module-arm test fixture',
      research: { sourceNodeIds: [] },
      addendum: 'addendum.txt',
      tools: [],
      status,
      kernelCompat: 1,
    })
  );
  fs.writeFileSync(path.join(moduleDir, 'addendum.txt'), 'FIXTURE PROTOCOL\n');
  return dir;
}

describe('resolveProbeModuleSelection / probeModulesJson', () => {
  it('unset composes the byte-identical historical spawn value (the pin)', () => {
    // Before Session 28 armEnv hardcoded exactly this string; the flag
    // unset must not move a single byte of the spawn env.
    expect(probeModulesJson(undefined)).toBe('["spatial-flywheel"]');
    expect(resolveProbeModuleSelection(undefined)).toEqual(['spatial-flywheel']);
  });

  it('resolves the positive-control selection through the real registry', () => {
    // The §4(c) ON arm: module #2 joins module #0 through the ORDINARY
    // loader (existence + active status + addendum gates) — the same
    // path a real operator TRELLIS_MODULES selection crosses.
    const raw = '["spatial-flywheel","estimation-discipline"]';
    expect(resolveProbeModuleSelection(raw)).toEqual([
      'spatial-flywheel',
      'estimation-discipline',
    ]);
    expect(probeModulesJson(raw)).toBe(raw);
  });

  it('refuses malformed JSON before any spawn', () => {
    expect(() => resolveProbeModuleSelection('{oops')).toThrow(
      new RegExp(`Invalid ${MODULE_ARM_ENV_VAR}.*not valid JSON`)
    );
    expect(() => resolveProbeModuleSelection('"spatial-flywheel"')).toThrow(/array/);
  });

  it('refuses an over-cap or duplicate selection', () => {
    expect(() => resolveProbeModuleSelection('["a","b","c","d","e"]')).toThrow(/at most 4/);
    expect(() => resolveProbeModuleSelection('["a","a"]')).toThrow(/duplicate/);
  });

  it('refuses a module name unknown to the registry', () => {
    expect(() => resolveProbeModuleSelection('["ghost-module"]')).toThrow(
      /registry validation.*not registered/s
    );
  });

  it('refuses a registered but non-active module (only active modules compose)', () => {
    const contested = fixtureRegistry('contested');
    expect(() => resolveProbeModuleSelection('["fixture-module"]', contested)).toThrow(
      /cannot be composed/
    );
    const active = fixtureRegistry('active');
    expect(resolveProbeModuleSelection('["fixture-module"]', active)).toEqual([
      'fixture-module',
    ]);
  });
});
