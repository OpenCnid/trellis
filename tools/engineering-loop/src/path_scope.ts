import { z } from 'zod';
import { MAX_COLLECTION_ITEMS, MAX_PATH_LENGTH, parseBoundary } from './domain.js';

const WINDOWS_RESERVED_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_ALIAS_CHARACTERS = /[<>:"|?*\u0000-\u001f]/;

export class PathScopeError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'PathScopeError';
  }
}

export function normalizeRepositoryPath(value: unknown, label = 'Repository path'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) {
    throw new PathScopeError(`${label} must be nonempty and no longer than ${MAX_PATH_LENGTH} characters`);
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_PATH_LENGTH) {
    throw new PathScopeError(`${label} must be no longer than ${MAX_PATH_LENGTH} UTF-8 bytes`);
  }
  if (value !== value.normalize('NFC')) {
    throw new PathScopeError(`${label} must already be Unicode NFC normalized`);
  }
  if (
    value.includes('\\')
    || value.startsWith('/')
    || /^[A-Za-z]:/.test(value)
    || value.endsWith('/')
  ) {
    throw new PathScopeError(`${label} must use repository-relative slash form`);
  }
  const segments = value.split('/');
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..') {
      throw new PathScopeError(`${label} contains an empty or traversal segment`);
    }
    if (
      segment.endsWith('.')
      || segment.endsWith(' ')
      || WINDOWS_ALIAS_CHARACTERS.test(segment)
      || WINDOWS_RESERVED_BASENAME.test(segment)
    ) {
      throw new PathScopeError(`${label} contains a platform-aliased segment`);
    }
  }
  return segments.join('/');
}

const ScopeListSchema = z.array(z.string()).min(1).max(MAX_COLLECTION_ITEMS);
const ChangedPathListSchema = z.array(z.string()).max(MAX_COLLECTION_ITEMS * 8);

export function normalizeAllowedScopes(value: unknown): string[] {
  const raw = parseBoundary(ScopeListSchema, value, 'allowed path scope');
  const normalized = raw.map((scope, index) => normalizeRepositoryPath(scope, `Allowed scope ${index + 1}`));
  const aliases = new Set<string>();
  for (const scope of normalized) {
    const aliasKey = scope.toLocaleLowerCase('en-US');
    if (aliases.has(aliasKey)) throw new PathScopeError('Allowed path scope contains duplicate platform aliases');
    aliases.add(aliasKey);
  }
  return [...normalized].sort();
}

export function isPathWithinScope(path: string, scope: string): boolean {
  const pathSegments = path.split('/');
  const scopeSegments = scope.split('/');
  return (
    pathSegments.length >= scopeSegments.length
    && scopeSegments.every((segment, index) => pathSegments[index] === segment)
  );
}

export interface PathScopeDecision {
  allowedScopes: string[];
  changedPaths: string[];
  outOfScope: string[];
  accepted: boolean;
}

export function evaluatePathScope(changedPathValue: unknown, allowedScopeValue: unknown): PathScopeDecision {
  const allowedScopes = normalizeAllowedScopes(allowedScopeValue);
  const rawPaths = parseBoundary(ChangedPathListSchema, changedPathValue, 'changed repository paths');
  const changedPaths = [...new Set(
    rawPaths.map((path, index) => normalizeRepositoryPath(path, `Changed path ${index + 1}`))
  )].sort();
  const outOfScope = changedPaths.filter(path => !allowedScopes.some(scope => isPathWithinScope(path, scope)));
  return { allowedScopes, changedPaths, outOfScope, accepted: outOfScope.length === 0 };
}

export function assertPathScope(changedPathValue: unknown, allowedScopeValue: unknown): PathScopeDecision {
  const decision = evaluatePathScope(changedPathValue, allowedScopeValue);
  if (!decision.accepted) {
    throw new PathScopeError(`Changed paths are outside the fixed scope: ${decision.outOfScope.join(', ')}`);
  }
  return decision;
}
