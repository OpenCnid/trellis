// Session 8: pure manifest diff between the previous published snapshot's
// effective path set and the current scan. Path-level only — content
// changes are the per-document Merkle diff's job. A rename appears here
// as one removed path plus one added path.

export interface ManifestDiff {
  added: string[];
  retained: string[];
  removed: string[];
}

export function diffManifests(
  previousPaths: Iterable<string>,
  currentPaths: Iterable<string>
): ManifestDiff {
  const previous = new Set(previousPaths);
  const current = new Set(currentPaths);
  const added: string[] = [];
  const retained: string[] = [];
  const removed: string[] = [];
  for (const path of current) {
    (previous.has(path) ? retained : added).push(path);
  }
  for (const path of previous) {
    if (!current.has(path)) removed.push(path);
  }
  added.sort();
  retained.sort();
  removed.sort();
  return { added, retained, removed };
}
