import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import {
  GUILDS,
  RELATIONAL_CAPTAIN_COUNT,
  RELATIONAL_HOUSE_COUNT,
  allRelationalDocs,
  buildGuildIndex,
  buildTariffIndex,
  generateRelationalCorpus,
  guildProfile,
  parseLedgerRecords,
  parseRegistryRecords,
  parseTariffRecords,
  tariffIntoPort,
  topGuildByTariff,
  topGuildForMaterial,
  totalsByGuildForMaterial,
} from './relational_corpus';
import { VOCABULARY_POOLS } from './synthetic_corpus';

// Session 23: the relational corpus is DETERMINISTIC — the concat sha
// pin below is the byte-stability guarantee (the round-2 ledger
// discipline). If it moves, either the generator changed wittingly
// (recompute here in the same commit and re-ingest the corpus) or
// something non-deterministic crept in — find out which before touching
// the pin.

const RELATIONAL_CONCAT_SHA256 =
  '3bbbea18096dd4ff2745bc5eb8eb17694f27d3661d971b8a41498c653c95a697';

const sha256 = (text: string) =>
  crypto.createHash('sha256').update(text, 'utf8').digest('hex');

describe('generateRelationalCorpus', () => {
  const corpus = generateRelationalCorpus();
  const docs = allRelationalDocs(corpus);
  const registry = parseRegistryRecords(corpus.registry.text);
  const tariffs = parseTariffRecords(corpus.tariff.text);
  const records = corpus.ledgers.flatMap(d => parseLedgerRecords(d.text));

  it('is byte-stable (the concatenation sha pin) with the full document set', () => {
    expect(docs).toHaveLength(RELATIONAL_HOUSE_COUNT + 2);
    expect(sha256(docs.map(d => d.text).join(''))).toBe(RELATIONAL_CONCAT_SHA256);
    expect(new Set(docs.map(d => d.docKey)).size).toBe(docs.length);
    expect(docs.map(d => d.docKey)).toContain('ledger:synthetic:s2-house-001');
    expect(docs.map(d => d.docKey)).toContain('registry:synthetic:captains');
    expect(docs.map(d => d.docKey)).toContain('tariff:synthetic:port-schedule');
  });

  it('is ASCII-only and does not collide with the round-2 ledger key prefix', () => {
    for (const doc of docs) {
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(doc.text)).toBe(true);
      expect(doc.docKey.startsWith('ledger:synthetic:house-')).toBe(false);
    }
  });

  it('reaches genuine relational scale (the round-3 regime)', () => {
    // ~3x the round-2 record count and a bigger byte volume than the
    // Frankenstein corpus — the scale axis of the pillar §7 question.
    expect(records.length).toBe(6859);
    expect(Buffer.byteLength(docs.map(d => d.text).join(''), 'utf8')).toBe(583128);
    expect(registry).toHaveLength(RELATIONAL_CAPTAIN_COUNT);
    expect(tariffs).toHaveLength(
      VOCABULARY_POOLS.PORTS.length * VOCABULARY_POOLS.MATERIALS.length
    );
  });

  it('joins are total: every ledger captain is registered, every (port, material) tariffed', () => {
    const guildIndex = buildGuildIndex(registry);
    const tariffIndex = buildTariffIndex(tariffs);
    for (const r of records) {
      expect(guildIndex.has(r.captain)).toBe(true);
      expect(tariffIndex.has(`${r.port}|${r.material}`)).toBe(true);
    }
    // Round-robin assignment: memberships stay balanced (4-5 captains
    // per guild), so no guild degenerately tops every aggregate.
    const perGuild = new Map<string, number>();
    for (const r of registry) perGuild.set(r.guild, (perGuild.get(r.guild) ?? 0) + 1);
    expect(perGuild.size).toBe(GUILDS.length);
    for (const count of perGuild.values()) {
      expect(count).toBeGreaterThanOrEqual(4);
      expect(count).toBeLessThanOrEqual(5);
    }
  });

  it('has tie-free answers for the round-3 question targets', () => {
    const guildIndex = buildGuildIndex(registry);
    const tariffIndex = buildTariffIndex(tariffs);
    // Every material has a tie-free top guild (the probe may target any).
    for (const material of VOCABULARY_POOLS.MATERIALS) {
      const top = topGuildForMaterial(records, guildIndex, material);
      expect(GUILDS).toContain(top.guild);
      expect(top.total).toBeGreaterThan(0);
    }
    // The three-table join has one clear winner.
    const topTariff = topGuildByTariff(records, guildIndex, tariffIndex);
    expect(GUILDS).toContain(topTariff.guild);
    expect(topTariff.silver).toBeGreaterThan(0);
    // The profile target used by the probe question is tie-free...
    const profile = guildProfile(records, guildIndex, 'Farwater');
    expect(profile.crates).toBeGreaterThan(0);
    expect(profile.captainCount).toBeGreaterThanOrEqual(4);
    expect(VOCABULARY_POOLS.PORTS).toContain(profile.topPort);
    // ...and the tie refusal is real: Duskhollow's port frequencies tie
    // in the generated data, so it can never anchor the profile question.
    expect(() => guildProfile(records, guildIndex, 'Duskhollow')).toThrow(/Tie/);
  });

  it('keeps guild names substring-free against every other vocabulary pool', () => {
    const all = [...(Object.values(VOCABULARY_POOLS).flat() as string[]), ...GUILDS];
    for (const a of all) {
      for (const b of all) {
        if (a !== b) expect(b.includes(a)).toBe(false);
      }
    }
  });
});

describe('relational parses are representation-invariant under block gluing', () => {
  const registryLines = [
    'Captain Alpha Beta sails under the banner of the Amberfall Guild.',
    'Captain Gamma Delta sails under the banner of the Mossgate Guild.',
  ];
  const tariffLines = [
    'Port Veleth levies a tariff of 7 silver per crate of veldspar.',
    'Port Ellim levies a tariff of 12 silver per crate of mirrowax.',
  ];

  it('parses registry and tariff records identically with and without line breaks', () => {
    expect(parseRegistryRecords(registryLines.join('\n')))
      .toEqual(parseRegistryRecords(registryLines.join('')));
    expect(parseTariffRecords(tariffLines.join('\n')))
      .toEqual(parseTariffRecords(tariffLines.join('')));
    expect(parseRegistryRecords(registryLines.join(''))).toEqual([
      { captain: 'Alpha Beta', guild: 'Amberfall' },
      { captain: 'Gamma Delta', guild: 'Mossgate' },
    ]);
    expect(parseTariffRecords(tariffLines.join(''))).toEqual([
      { port: 'Port Veleth', silverPerCrate: 7, material: 'veldspar' },
      { port: 'Port Ellim', silverPerCrate: 12, material: 'mirrowax' },
    ]);
  });

  it('refuses malformed records loudly', () => {
    expect(() =>
      parseRegistryRecords('Captain Solo sails under the banner of the Amberfall Guild.')
    ).toThrow(/Malformed registry/);
    expect(() =>
      parseTariffRecords('Port Veleth levies a tariff of many silver per crate of veldspar.')
    ).toThrow(/Malformed tariff/);
    expect(parseRegistryRecords('No records here.')).toEqual([]);
    expect(parseTariffRecords('No records here.')).toEqual([]);
  });
});

describe('join helpers', () => {
  const registry = parseRegistryRecords(
    [
      'Captain Alpha Beta sails under the banner of the Amberfall Guild.',
      'Captain Gamma Delta sails under the banner of the Mossgate Guild.',
      'Captain Epsilon Zeta sails under the banner of the Amberfall Guild.',
    ].join('\n')
  );
  const tariffs = parseTariffRecords(
    [
      'Port Veleth levies a tariff of 3 silver per crate of veldspar.',
      'Port Veleth levies a tariff of 5 silver per crate of mirrowax.',
      'Port Ellim levies a tariff of 2 silver per crate of veldspar.',
    ].join('\n')
  );
  const records = parseLedgerRecords(
    [
      'On day 1, Captain Alpha Beta shipped 10 crates of veldspar to Port Veleth.',
      'On day 2, Captain Gamma Delta shipped 4 crates of veldspar to Port Ellim.',
      'On day 3, Captain Epsilon Zeta shipped 6 crates of mirrowax to Port Veleth.',
      'On day 4, Captain Alpha Beta shipped 2 crates of veldspar to Port Ellim.',
    ].join('\n')
  );
  const guildIndex = buildGuildIndex(registry);
  const tariffIndex = buildTariffIndex(tariffs);

  it('joins ledger records to guilds and aggregates per material', () => {
    const totals = totalsByGuildForMaterial(records, guildIndex, 'veldspar');
    expect(totals.get('Amberfall')).toBe(12);
    expect(totals.get('Mossgate')).toBe(4);
    expect(topGuildForMaterial(records, guildIndex, 'veldspar'))
      .toEqual({ guild: 'Amberfall', total: 12 });
  });

  it('computes tariff totals per port and per guild (the three-table join)', () => {
    // Port Veleth: 10 crates x 3 (veldspar) + 6 crates x 5 (mirrowax).
    expect(tariffIntoPort(records, tariffIndex, 'Port Veleth')).toBe(60);
    // Amberfall: 10x3 + 2x2 (veldspar) + 6x5 (mirrowax) = 64; Mossgate: 4x2 = 8.
    expect(topGuildByTariff(records, guildIndex, tariffIndex))
      .toEqual({ guild: 'Amberfall', silver: 64 });
  });

  it('profiles a guild: crates, distinct captains, modal port', () => {
    expect(guildProfile(records, guildIndex, 'Amberfall'))
      .toEqual({ crates: 18, captainCount: 2, topPort: 'Port Veleth' });
    expect(() => guildProfile(records, guildIndex, 'Larkspur')).toThrow(/No ledger records/);
  });

  it('is loud on unknown captains, missing tariffs, duplicates, and ties', () => {
    const stray = parseLedgerRecords(
      'On day 5, Captain Un Known shipped 1 crates of veldspar to Port Veleth.'
    );
    expect(() => totalsByGuildForMaterial(stray, guildIndex, 'veldspar'))
      .toThrow(/missing from the registry/);
    const untariffed = parseLedgerRecords(
      'On day 6, Captain Alpha Beta shipped 1 crates of grimsalt to Port Veleth.'
    );
    expect(() => tariffIntoPort(untariffed, tariffIndex, 'Port Veleth'))
      .toThrow(/No tariff/);
    expect(() => buildGuildIndex([...registry, registry[0]])).toThrow(/Duplicate registry/);
    expect(() => buildTariffIndex([...tariffs, tariffs[0]])).toThrow(/Duplicate tariff/);
    const tied = parseLedgerRecords(
      [
        'On day 1, Captain Alpha Beta shipped 5 crates of veldspar to Port Veleth.',
        'On day 2, Captain Gamma Delta shipped 5 crates of veldspar to Port Ellim.',
      ].join('\n')
    );
    expect(() => topGuildForMaterial(tied, guildIndex, 'veldspar')).toThrow(/Tie/);
  });
});
