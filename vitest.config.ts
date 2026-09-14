import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'shared/**/*.test.ts',
      'desktop/**/*.test.ts',
      'renderer/**/*.test.ts',
      'renderer/**/*.test.tsx'
    ],
    environment: 'node',
    environmentMatchGlobs: [['renderer/**', 'jsdom']],
    setupFiles: ['./tests/setup.ts']
  }
});
