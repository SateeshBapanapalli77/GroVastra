import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setupTestDb.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false
  }
});
