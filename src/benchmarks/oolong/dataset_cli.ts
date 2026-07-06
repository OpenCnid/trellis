import * as fs from 'fs';
import * as path from 'path';
import { OolongDataset, OolongDatasetSchema } from './schema';

// Session 6: shared --dataset plumbing for the OOLONG harness CLIs.
// Every script that hardcoded the v1 path now accepts
// `--dataset <path>` and defaults to v1, so v1 and the v2 anti-shortcut
// corpus run through identical machinery.

export const V1_DATASET_PATH = path.join(__dirname, '..', '..', '..', 'data', 'oolong_pairs_dataset.json');
export const HARD_DATASET_PATH = path.join(__dirname, '..', '..', '..', 'data', 'oolong_pairs_dataset_hard.json');

/**
 * Pure argv parsing: returns the value following `--dataset`, or
 * undefined when the flag is absent. Throws on a dangling flag.
 */
export function parseDatasetArg(argv: readonly string[]): string | undefined {
  const index = argv.indexOf('--dataset');
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('--dataset requires a path argument');
  }
  return value;
}

/** Resolves the dataset path from argv, defaulting to v1. */
export function resolveDatasetPath(argv: readonly string[], defaultPath: string = V1_DATASET_PATH): string {
  const arg = parseDatasetArg(argv);
  return arg ? path.resolve(arg) : defaultPath;
}

/** Boundary validation (Architecture Invariant 3): read + Zod parse. */
export function loadDataset(datasetPath: string): OolongDataset {
  return OolongDatasetSchema.parse(JSON.parse(fs.readFileSync(datasetPath, 'utf8')));
}
