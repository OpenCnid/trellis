import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadModule, readModuleManifest } from '../../config/modules';
import { pinnedSourceNodeIds, type PromotedCorpus } from './corpus';
import {
  AUTHORED_ADDENDUM_FILENAME,
  assertAuthoredAddendum,
  buildAddendumText,
  buildManifest,
  buildResearchDoc,
} from './assemble';
import type { DraftEnvelope } from '../observability/rlm_draft';

// Session 19 (design record §5): the harness holds the pen —
// research.sourceNodeIds is pinned from the corpus, sorted and deduped;
// the model contributes only prose. The assembled directory must pass
// the same loader modules:register and the composer read it through.

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

const CORPUS: PromotedCorpus = {
  documents: [
    { docKey: 'research:trellis/contract', rootHash: 'd'.repeat(64), version: 1, blockHashes: [HASH_B, HASH_A] },
    { docKey: 'research:trellis/evidence', rootHash: 'e'.repeat(64), version: 2, blockHashes: [HASH_C, HASH_A] },
  ],
  // Deliberately unsorted, with a duplicate (HASH_A shared across docs).
  blocks: [
    { hash: HASH_B, text: 'b', docKey: 'research:trellis/contract' },
    { hash: HASH_A, text: 'a', docKey: 'research:trellis/contract' },
    { hash: HASH_C, text: 'c', docKey: 'research:trellis/evidence' },
  ],
};

const DRAFT: DraftEnvelope = {
  purpose: 'Teaches an RLM to reuse the workspace as durable working memory.',
  addendum: 'WORKSPACE DISCIPLINE PROTOCOL\nReuse prior snapshots; rebind atomically; raise on over-budget.',
  gapNotes: ['the corpus does not cover cross-goal sharing'],
};

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('pinnedSourceNodeIds', () => {
  it('is the corpus block set, sorted and deduped (D3 flat v1)', () => {
    expect(pinnedSourceNodeIds(CORPUS)).toEqual([HASH_A, HASH_B, HASH_C]);
  });
});

describe('assertAuthoredAddendum', () => {
  it('accepts a clean in-bounds addendum', () => {
    expect(() => assertAuthoredAddendum(DRAFT.addendum)).not.toThrow();
  });

  it('rejects empty, brace-bearing, and over-cap addenda', () => {
    expect(() => assertAuthoredAddendum('   ')).toThrow(/empty/);
    expect(() => assertAuthoredAddendum('has a {brace}')).toThrow(/braces/);
    expect(() => assertAuthoredAddendum('x'.repeat(20), 8)).toThrow(/bound/);
  });
});

describe('buildManifest', () => {
  it('pins research.sourceNodeIds verbatim and stays kernelCompat 1, active, tool-free', () => {
    const pinned = pinnedSourceNodeIds(CORPUS);
    const manifest = buildManifest({ moduleName: 'demo', purpose: DRAFT.purpose, sourceNodeIds: pinned });
    expect(manifest.research.sourceNodeIds).toEqual(pinned);
    expect(manifest.version).toBe(1);
    expect(manifest.status).toBe('active');
    expect(manifest.tools).toEqual([]);
    expect(manifest.kernelCompat).toBe(1);
    expect(manifest.addendum).toBe(AUTHORED_ADDENDUM_FILENAME);
  });

  it('derives acceptance.zeroPaid from the module name, so no two modules share a criterion', () => {
    const pinned = pinnedSourceNodeIds(CORPUS);
    const build = (moduleName: string) =>
      buildManifest({ moduleName, purpose: DRAFT.purpose, sourceNodeIds: pinned });

    expect(build('demo').acceptance.zeroPaid).toBe('npm run test:module -- demo');
    // The criterion names its own module: the schema rule, and the reason
    // the old constant was a defect — it was identical for every module.
    expect(build('spatial-flywheel').acceptance.zeroPaid).toContain('spatial-flywheel');
    expect(build('demo').acceptance.zeroPaid).not.toBe(build('other').acceptance.zeroPaid);
  });

  it('refuses to assemble a module that cannot name its own drill', () => {
    const pinned = pinnedSourceNodeIds(CORPUS);
    expect(() =>
      buildManifest({ moduleName: '', purpose: DRAFT.purpose, sourceNodeIds: pinned })
    ).toThrow(/no name/);
    expect(() =>
      buildManifest({ moduleName: '   ', purpose: DRAFT.purpose, sourceNodeIds: pinned })
    ).toThrow(/no name/);
  });
});

describe('buildResearchDoc', () => {
  it('names the corpus doc keys, roots, and declared gaps', () => {
    const doc = buildResearchDoc({
      moduleName: 'demo',
      topic: 'workspace discipline',
      corpus: CORPUS,
      gapNotes: DRAFT.gapNotes,
      provenanceNote: 'Drafted by a replayed draft.',
    });
    expect(doc).toContain('research:trellis/contract');
    expect(doc).toContain('research:trellis/evidence');
    expect(doc).toContain('d'.repeat(64));
    expect(doc).toContain('cross-goal sharing');
    expect(doc).toContain('module:demo');
  });
});

describe('assembled directory passes the module loader', () => {
  it('writes a module.json + addendum.txt that readModuleManifest and loadModule accept', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-author-assemble-'));
    tmpDirs.push(outDir);
    const moduleName = 'demo-module';
    const pinned = pinnedSourceNodeIds(CORPUS);
    const manifest = buildManifest({ moduleName, purpose: DRAFT.purpose, sourceNodeIds: pinned });

    const moduleDir = path.join(outDir, moduleName);
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'module.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(moduleDir, 'addendum.txt'), buildAddendumText(DRAFT));

    const read = readModuleManifest(moduleName, outDir);
    expect(read.research.sourceNodeIds).toEqual(pinned);
    // The derived criterion survives the schema, which requires zeroPaid
    // to contain the manifest's own name — an assembled module registers.
    expect(read.acceptance.zeroPaid).toBe(`npm run test:module -- ${moduleName}`);
    const loaded = loadModule(moduleName, outDir);
    expect(loaded.addendumText).toContain('WORKSPACE DISCIPLINE PROTOCOL');
    expect(loaded.addendumText).not.toMatch(/[{}]/);
    expect(loaded.addendumText.endsWith('\n')).toBe(true);
  });
});
