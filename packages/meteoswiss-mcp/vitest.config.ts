import { defineConfig } from 'vitest/config';

/**
 * Vitest replaces Jest (ts-jest ESM preset) — the suite was already ESM-mode
 * (`extensionsToTreatAsEsm` + `--experimental-vm-modules`), so the runner swap
 * removes that flag and the ts-jest transform in favour of Vite's native TS
 * handling. Jest config fields map as: testMatch→include,
 * setupFilesAfterEnv→setupFiles, maxWorkers→poolOptions.forks.maxForks,
 * collectCoverageFrom→coverage.include.
 */
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
    testTimeout: 60000, // 60 seconds for inspector tests (needed for macOS)
    pool: 'forks',
    poolOptions: {
      forks: {
        // Serialize on CI: 13 integration tests each spawn 2 child processes; concurrent
        // spawning starves 2-vCPU runners past the 30s boot timeout
        maxForks: process.env.CI ? 1 : '50%',
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,ts}'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.{js,ts}', 'src/**/test/**'],
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
