import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts'],
    benchmark: {
      include: ['test/**/*.bench.ts']
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
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