import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  EST_CHRONICLE_ANOMALY,
  EST_CHRONICLE_NEEDLES,
  EST_FRANK_NEEDLE,
  EST_FRANK_PHRASE,
  EST_LEDGER_CAPTAIN,
  EST_LEDGER_MATERIAL,
  EST_MIN_EVIDENCE_CALLS,
  EST_REL_GUILD,
  estChronicleCounts,
  estChronicleQuoteEntry,
  estFrankLocateCount,
  estLedgerCaptainMaterial,
  estRelationalGuild,
} from './estimation_suite';
import { generateChronicle, generateLedgers } from './synthetic_corpus';
import { generateRelationalCorpus, GUILDS } from './relational_corpus';

// Session 28: the estimation-discipline positive-control ground truths,
// pinned from the committed corpus bytes and the deterministic
// generators (the ground_truth.test.ts house pattern) — an edit to any
// corpus fails loudly here instead of silently shifting the control's
// truth. The minimal-evidence bounds are pinned alongside: they are the
// recorded per-question documentation the measurement reports against.

const chronicle = fs.readFileSync(
  path.resolve(__dirname, '..', '..', '..', 'data', 'synthetic_chronicle.txt'),
  'utf-8'
);
const frank = fs.readFileSync(
  path.resolve(__dirname, '..', '..', '..', 'data', 'frankenstein.txt'),
  'utf-8'
);

describe('the est- question ground truths (pinned from committed bytes)', () => {
  it('pins the chronicle needle counts (est-chr-counts)', () => {
    expect(EST_CHRONICLE_NEEDLES).toEqual(['Kelvorin', 'Torulf']);
    expect(estChronicleCounts(chronicle)).toEqual({ first: 163, second: 125 });
    // The committed generator reproduces the committed bytes, so the
    // generated corpus pins identically.
    expect(estChronicleCounts(generateChronicle())).toEqual({ first: 163, second: 125 });
  });

  it('pins the anomaly quote-and-entry truth (est-chr-quote-entry)', () => {
    expect(EST_CHRONICLE_ANOMALY).toBe(8);
    const truth = estChronicleQuoteEntry(chronicle);
    expect(truth.phrase).toBe('the lodestone of Sablewick');
    expect(truth.sentence).toBe(
      'It is recorded that the lodestone of Sablewick was catalogued under the pale seal '
      + 'and never spoken of again.'
    );
    expect(truth.entry).toBe('Entry 9');
  });

  it('keeps the est anomaly clear of every other suite anomaly', () => {
    // quote 11/30, locate 5/42/23/36, edit 17 — the est question must
    // not share an anomaly with a round-comparable suite.
    expect([11, 30, 5, 42, 23, 36, 17]).not.toContain(EST_CHRONICLE_ANOMALY);
  });

  it('pins the frank locate-and-count truth (est-frank-locate-count)', () => {
    expect(EST_FRANK_PHRASE).toBe('It was on a dreary night of November');
    expect(EST_FRANK_NEEDLE).toBe('Ingolstadt');
    expect(estFrankLocateCount(frank)).toEqual({ section: 'Chapter 5', count: 16 });
  });

  it('pins the ledger captain-material truth (est-led-captain)', () => {
    expect(EST_LEDGER_CAPTAIN).toBe('Zelvane Wendrick');
    expect(EST_LEDGER_MATERIAL).toBe('morrowleaf');
    expect(estLedgerCaptainMaterial(generateLedgers())).toEqual({
      total: 1046,
      ledgersWith: 13,
    });
  });

  it('pins the relational guild truth (est-rel-guild)', () => {
    expect(GUILDS).toContain(EST_REL_GUILD);
    expect(estRelationalGuild(generateRelationalCorpus())).toEqual({
      crates: 41793,
      captainCount: 4,
    });
  });

  it('pins the minimal-evidence bounds for every est question', () => {
    // One shared read binds every question's parts (the rationale lives
    // on the constant): the recorded repeat-retrieval pressure.
    expect(EST_MIN_EVIDENCE_CALLS).toEqual({
      'est-chr-counts': 1,
      'est-chr-quote-entry': 1,
      'est-frank-locate-count': 1,
      'est-led-captain': 1,
      'est-rel-guild': 1,
    });
  });
});

describe('the est design-error refusals', () => {
  it('refuses equal needle counts', () => {
    const equal = 'Kelvorin met Torulf. Kelvorin left; Torulf stayed.';
    expect(() => estChronicleCounts(equal)).toThrow(/both 2/);
  });

  it('refuses a ledger pair with no records', () => {
    expect(() =>
      estLedgerCaptainMaterial([
        { house: '99', docKey: 'ledger:synthetic:house-99', text: 'No records here.' },
      ])
    ).toThrow(/No ledger records/);
  });
});
