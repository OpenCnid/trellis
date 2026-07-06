import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { parseDatasetArg, resolveDatasetPath, loadDataset, V1_DATASET_PATH, HARD_DATASET_PATH } from './dataset_cli';

describe('parseDatasetArg', () => {
  it('returns undefined when the flag is absent', () => {
    expect(parseDatasetArg([])).toBeUndefined();
    expect(parseDatasetArg(['--seed', '42'])).toBeUndefined();
  });

  it('returns the path following --dataset', () => {
    expect(parseDatasetArg(['--dataset', 'data/foo.json'])).toBe('data/foo.json');
    expect(parseDatasetArg(['--seed', '1', '--dataset', 'x.json'])).toBe('x.json');
  });

  it('throws on a dangling or flag-valued --dataset', () => {
    expect(() => parseDatasetArg(['--dataset'])).toThrow(/requires a path/);
    expect(() => parseDatasetArg(['--dataset', '--other'])).toThrow(/requires a path/);
  });
});

describe('resolveDatasetPath', () => {
  it('defaults to the v1 dataset', () => {
    expect(resolveDatasetPath([])).toBe(V1_DATASET_PATH);
  });

  it('resolves an explicit path absolutely', () => {
    expect(path.isAbsolute(resolveDatasetPath(['--dataset', 'data/foo.json']))).toBe(true);
  });
});

describe('loadDataset', () => {
  it('loads and Zod-validates the committed v1 dataset', () => {
    const dataset = loadDataset(V1_DATASET_PATH);
    expect(dataset.name).toBe('oolong-pairs-trec-synthetic-v1');
    expect(dataset.records.length).toBe(220);
    expect(dataset.distractor_passages).toBeUndefined();
  });

  it('loads and Zod-validates the committed v2 (hard) dataset', () => {
    const dataset = loadDataset(HARD_DATASET_PATH);
    expect(dataset.name).toBe('oolong-pairs-trec-synthetic-v2');
    expect(dataset.records.length).toBe(220);
    expect(dataset.distractor_passages?.length).toBe(20);
  });
});
