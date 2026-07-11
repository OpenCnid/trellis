import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  CHRONICLE_ENTRIES,
  LEDGER_HOUSE_COUNT,
  chronicleAnomalyPhrase,
  generateChronicle,
  generateLedgers,
  mulberry32,
  parseLedgerRecords,
  topPortForMaterial,
  totalForCaptainMaterial,
  totalsByPort,
  VOCABULARY_POOLS,
} from './synthetic_corpus';
import {
  countOccurrences,
  sectionContainingBy,
  sentenceContaining,
} from './ground_truth';

// Session 22: the synthetic corpora are DETERMINISTIC — the sha pins
// below are the byte-stability guarantee (the .gitattributes -text
// discipline for the committed chronicle; the generator itself for the
// ledgers). If a pin moves, either the generator changed wittingly
// (recompute here in the same commit and re-ingest the corpora) or
// something non-deterministic crept in — find out which before touching
// the pin.

const CHRONICLE_SHA256 =
  'b56f6d32e99379ccab46f207c9318553040fc281a2633adc2670f544749df1e6';
const LEDGER_CONCAT_SHA256 =
  '85d4394436320a0e0f1dd936f8803fd571fabaaa80dbf8e716f6ac5d4a055a37';

const sha256 = (text: string) =>
  crypto.createHash('sha256').update(text, 'utf8').digest('hex');

describe('mulberry32', () => {
  it('is deterministic and seed-sensitive', () => {
    const a1 = mulberry32(1);
    const a2 = mulberry32(1);
    const b = mulberry32(2);
    const seqA1 = [a1(), a1(), a1()];
    const seqA2 = [a2(), a2(), a2()];
    const seqB = [b(), b(), b()];
    expect(seqA1).toEqual(seqA2);
    expect(seqA1).not.toEqual(seqB);
    expect(seqA1.every(v => v >= 0 && v < 1)).toBe(true);
  });
});

describe('generateChronicle', () => {
  const text = generateChronicle();

  it('is byte-stable (the sha pin)', () => {
    expect(sha256(text)).toBe(CHRONICLE_SHA256);
  });

  it('equals the committed data/synthetic_chronicle.txt byte-for-byte', () => {
    const committed = fs.readFileSync(
      path.resolve('data', 'synthetic_chronicle.txt'),
      'utf8'
    );
    expect(committed.includes('\r')).toBe(false); // .gitattributes -text held
    expect(sha256(committed)).toBe(CHRONICLE_SHA256);
    expect(committed).toBe(text);
  });

  it('is ASCII-only with the full entry structure', () => {
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(text)).toBe(true);
    expect((text.match(/^Entry \d+$/gm) ?? []).length).toBe(CHRONICLE_ENTRIES);
  });

  it('plants every anomaly phrase exactly once, locatable to its entry', () => {
    for (let i = 0; i < CHRONICLE_ENTRIES; i++) {
      const phrase = chronicleAnomalyPhrase(i);
      expect(countOccurrences(text, phrase)).toBe(1);
      // sentenceContaining throws unless the phrase is unique; the
      // section must be the entry the generator planted it in.
      expect(sentenceContaining(text, phrase)).toContain(phrase);
      expect(sectionContainingBy(text, phrase, ['Entry'])).toBe(`Entry ${i + 1}`);
    }
  });

  it('keeps the vocabulary pools mutually substring-free (exact counting stays well-posed)', () => {
    const all = Object.values(VOCABULARY_POOLS).flat() as string[];
    for (const a of all) {
      for (const b of all) {
        if (a !== b) expect(b.includes(a)).toBe(false);
      }
    }
  });
});

describe('generateLedgers', () => {
  const docs = generateLedgers();

  it('is byte-stable (the concatenation sha pin) with the full house set', () => {
    expect(docs).toHaveLength(LEDGER_HOUSE_COUNT);
    expect(sha256(docs.map(d => d.text).join(''))).toBe(LEDGER_CONCAT_SHA256);
    expect(docs.map(d => d.docKey)).toContain('ledger:synthetic:house-01');
    expect(new Set(docs.map(d => d.docKey)).size).toBe(LEDGER_HOUSE_COUNT);
  });

  it('round-trips every record through the text parse (representation invariance)', () => {
    const records = docs.flatMap(d => parseLedgerRecords(d.text));
    expect(records.length).toBeGreaterThan(LEDGER_HOUSE_COUNT * 40);
    for (const r of records.slice(0, 50)) {
      expect(r.day).toBeGreaterThanOrEqual(1);
      expect(r.day).toBeLessThanOrEqual(90);
      expect(r.crates).toBeGreaterThanOrEqual(5);
      expect(r.crates).toBeLessThanOrEqual(99);
      expect(VOCABULARY_POOLS.MATERIALS).toContain(r.material);
      expect(VOCABULARY_POOLS.PORTS).toContain(r.port);
    }
  });

  it('has a tie-free top port for every material (question well-posedness)', () => {
    const records = docs.flatMap(d => parseLedgerRecords(d.text));
    for (const material of VOCABULARY_POOLS.MATERIALS) {
      const top = topPortForMaterial(records, material);
      expect(top.total).toBeGreaterThan(0);
      expect(VOCABULARY_POOLS.PORTS).toContain(top.port);
    }
  });
});

describe('ledger aggregation helpers', () => {
  const records = parseLedgerRecords(
    [
      'On day 1, Captain Alpha Beta shipped 10 crates of veldspar to Port Veleth.',
      'On day 2, Captain Alpha Beta shipped 5 crates of veldspar to Port Ellim.',
      'On day 3, Captain Gamma Delta shipped 7 crates of veldspar to Port Veleth.',
      'On day 4, Captain Alpha Beta shipped 9 crates of mirrowax to Port Veleth.',
    ].join('\n')
  );

  it('parses only record-shaped text and refuses malformed records', () => {
    expect(records).toHaveLength(4);
    expect(parseLedgerRecords('Header prose.\n\nNothing here.')).toHaveLength(0);
    expect(() => parseLedgerRecords('On day twelve, Captain X Y shipped 3 crates of a to Port B.'))
      .toThrow(/Malformed/);
  });

  it('is representation-invariant under block gluing (unmarked paragraph boundaries)', () => {
    // The AST reconstruction concatenates blocks with no separator; the
    // shape-based parse must return the same records either way.
    const glued =
      'On day 1, Captain Alpha Beta shipped 10 crates of veldspar to Port Veleth.'
      + 'On day 2, Captain Alpha Beta shipped 5 crates of veldspar to Port Ellim.';
    expect(parseLedgerRecords(glued)).toEqual(records.slice(0, 2));
  });

  it('aggregates totals by port, top port, and captain-material totals', () => {
    expect(totalsByPort(records, 'veldspar').get('Port Veleth')).toBe(17);
    expect(topPortForMaterial(records, 'veldspar')).toEqual({ port: 'Port Veleth', total: 17 });
    expect(totalForCaptainMaterial(records, 'Alpha Beta', 'veldspar')).toBe(15);
    expect(totalForCaptainMaterial(records, 'Alpha Beta', 'mirrowax')).toBe(9);
  });

  it('refuses a tie for the top port', () => {
    const tied = parseLedgerRecords(
      [
        'On day 1, Captain Alpha Beta shipped 10 crates of grimsalt to Port Veleth.',
        'On day 2, Captain Alpha Beta shipped 10 crates of grimsalt to Port Ellim.',
      ].join('\n')
    );
    expect(() => topPortForMaterial(tied, 'grimsalt')).toThrow(/Tie/);
    expect(() => topPortForMaterial(tied, 'absent')).toThrow(/No records/);
  });
});
