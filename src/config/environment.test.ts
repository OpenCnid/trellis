import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvironmentFile } from './environment';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe('loadEnvironmentFile', () => {
  it('loads a local env file without overriding an explicit environment value', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'trellis-env-'));
    temporaryDirectories.push(directory);
    const envPath = path.join(directory, '.env');
    await writeFile(envPath, 'PORT=4111\nAPI_KEY=file-key\n', 'utf8');
    const target: Record<string, string> = { API_KEY: 'explicit-key' };

    const result = loadEnvironmentFile(envPath, target);

    expect(result.error).toBeUndefined();
    expect(target).toEqual({ PORT: '4111', API_KEY: 'explicit-key' });
  });
});
