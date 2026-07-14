// Session 48 (TTT-track increment T1, MODEL_BACKEND_SEAM.md sections
// 3 and 4 layer 1): unit pins for the TRELLIS_RLM_* config surface.
// Pre-staged header (the editing toolkit loads existing files only);
// the test body below is authored by the stage-2 self-edit run.

import { afterEach, describe, expect, it, vi } from 'vitest';

const RLM_KEYS = [
  'TRELLIS_RLM_BACKEND',
  'TRELLIS_RLM_MODEL',
  'TRELLIS_RLM_BASE_URL',
  'TRELLIS_RLM_API_KEY_ENV',
  'OPENAI_BASE_URL',
  'RLM_BACKEND_TEST_API_KEY',
] as const;

const saved = new Map<string, string | undefined>();

function setEnv(overrides: Partial<Record<(typeof RLM_KEYS)[number], string>>): void {
  for (const key of RLM_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function loadConfig() {
  vi.resetModules();
  const module = await import('./index');
  return module.config;
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  vi.resetModules();
});

describe('rlm backend configuration', () => {
  it('defaults every field to undefined when unset', async () => {
    setEnv({});
    const config = await loadConfig();
    expect(config.rlmBackend).toEqual({
      backend: undefined,
      model: undefined,
      baseUrl: undefined,
      apiKeyEnv: undefined,
      apiKeyValue: undefined,
    });
  });

  it('accepts openai alone and vllm with a base URL, and rejects unknown backends', async () => {
    setEnv({ TRELLIS_RLM_BACKEND: 'openai' });
    await expect(loadConfig()).resolves.toMatchObject({
      rlmBackend: expect.objectContaining({ backend: 'openai' }),
    });

    setEnv({ TRELLIS_RLM_BACKEND: 'vllm', TRELLIS_RLM_BASE_URL: 'http://127.0.0.1:8000/v1' });
    await expect(loadConfig()).resolves.toMatchObject({
      rlmBackend: expect.objectContaining({ backend: 'vllm', baseUrl: 'http://127.0.0.1:8000/v1' }),
    });

    setEnv({ TRELLIS_RLM_BACKEND: 'other' });
    await expect(loadConfig()).rejects.toThrow(/TRELLIS_RLM_BACKEND/);
  });

  it('accepts ordinary model ids and rejects empty or overlong values', async () => {
    setEnv({ TRELLIS_RLM_MODEL: 'gpt-4o-mini' });
    await expect(loadConfig()).resolves.toMatchObject({
      rlmBackend: expect.objectContaining({ model: 'gpt-4o-mini' }),
    });

    setEnv({ TRELLIS_RLM_MODEL: '' });
    await expect(loadConfig()).rejects.toThrow(/TRELLIS_RLM_MODEL/);

    setEnv({ TRELLIS_RLM_MODEL: 'x'.repeat(257) });
    await expect(loadConfig()).rejects.toThrow(/TRELLIS_RLM_MODEL/);
  });

  it('accepts http and https base URLs, and rejects non-URL or ftp schemes', async () => {
    setEnv({ TRELLIS_RLM_BASE_URL: 'http://127.0.0.1:8000/v1' });
    await expect(loadConfig()).resolves.toMatchObject({
      rlmBackend: expect.objectContaining({ baseUrl: 'http://127.0.0.1:8000/v1' }),
    });

    setEnv({ TRELLIS_RLM_BASE_URL: 'https://example.test/v1' });
    await expect(loadConfig()).resolves.toMatchObject({
      rlmBackend: expect.objectContaining({ baseUrl: 'https://example.test/v1' }),
    });

    setEnv({ TRELLIS_RLM_BASE_URL: 'not-a-url' });
    await expect(loadConfig()).rejects.toThrow(/TRELLIS_RLM_BASE_URL/);

    setEnv({ TRELLIS_RLM_BASE_URL: 'ftp://host/' });
    await expect(loadConfig()).rejects.toThrow(/TRELLIS_RLM_BASE_URL/);
  });

  it('refuses vllm without a base URL and names both keys', async () => {
    setEnv({ TRELLIS_RLM_BACKEND: 'vllm' });
    await expect(loadConfig()).rejects.toThrow(/TRELLIS_RLM_BACKEND/);
    await expect(loadConfig()).rejects.toThrow(/TRELLIS_RLM_BASE_URL/);
  });

  it('refuses key-env without a base URL and names both keys', async () => {
    setEnv({ TRELLIS_RLM_API_KEY_ENV: 'RLM_BACKEND_TEST_API_KEY' });
    await expect(loadConfig()).rejects.toThrow(/TRELLIS_RLM_API_KEY_ENV/);
    await expect(loadConfig()).rejects.toThrow(/TRELLIS_RLM_BASE_URL/);
  });

  it('resolves api key env names when the named variable is set', async () => {
    setEnv({ TRELLIS_RLM_BASE_URL: 'https://example.test/v1', TRELLIS_RLM_API_KEY_ENV: 'RLM_BACKEND_TEST_API_KEY', RLM_BACKEND_TEST_API_KEY: 'secret-token' });
    const config = await loadConfig();
    expect(config.rlmBackend).toMatchObject({
      apiKeyEnv: 'RLM_BACKEND_TEST_API_KEY',
      apiKeyValue: 'secret-token',
      baseUrl: 'https://example.test/v1',
    });
  });

  it('refuses missing or empty named api key variables', async () => {
    setEnv({ TRELLIS_RLM_BASE_URL: 'https://example.test/v1', TRELLIS_RLM_API_KEY_ENV: 'RLM_BACKEND_TEST_API_KEY' });
    await expect(loadConfig()).rejects.toThrow(/RLM_BACKEND_TEST_API_KEY/);

    setEnv({ TRELLIS_RLM_BASE_URL: 'https://example.test/v1', TRELLIS_RLM_API_KEY_ENV: 'RLM_BACKEND_TEST_API_KEY', RLM_BACKEND_TEST_API_KEY: '' });
    await expect(loadConfig()).rejects.toThrow(/RLM_BACKEND_TEST_API_KEY/);
  });

  it('rejects ambient OPENAI_BASE_URL with the exact guard message', async () => {
    setEnv({ OPENAI_BASE_URL: 'https://legacy.example/v1' });
    await expect(loadConfig()).rejects.toThrow('Backend config: OPENAI_BASE_URL is not honored; set TRELLIS_RLM_BASE_URL (root agent) — worker transport is not yet configurable.');
  });
});
