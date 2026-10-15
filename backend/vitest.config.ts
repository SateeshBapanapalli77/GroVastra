import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setupTestDb.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false
  }
});
