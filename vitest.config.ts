import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/utils/setup-browser.ts'],
    include: ['test/**/*.test.ts'],
    benchmark: {
      include: ['test/**/*.bench.ts']
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'demo/**',
        'test/**',
        'dist/**',
        'dist-demo/**'
      ]
    }
  },
});