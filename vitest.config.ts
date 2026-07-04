import { defineConfig } from 'vitest/config';

// Unit tests cover the pure modules only (parser hashing, benchmark
// scoring, SSE extraction) — no database or Docker infrastructure is
// required to run `npm test`. The frontend is a separate package with
// its own toolchain and is excluded.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['src/frontend/**', 'node_modules/**'],
  },
});
