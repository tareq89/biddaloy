import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    // Test file patterns
    include: [
      'src/**/*.spec.ts',
      'src/**/*.integration.spec.ts',
      'src/**/*.e2e-spec.ts',
    ],

    // Environment
    environment: 'node',
    globals: true,

    // Setup runs before all tests
    setupFiles: ['./test/setup.js'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/**/*.module.ts',
        'src/**/*.dto.ts',
        'src/**/*.entity.ts',
        'src/migrations/**',
        'src/scripts/**',
        'src/config/**',
        'src/**/*.e2e-spec.ts',
        'src/**/*.spec.ts',
        'src/**/*.integration.spec.ts',
      ],
      thresholds: {
        perFile: false,
        branches: 75,
        functions: 75,
        lines: 75,
        statements: 75,
      },
    },

    // Integration and E2E tests run sequentially
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
  resolve: {
    alias: {
      '@beton-boi/shared': resolve(__dirname, '../shared/src'),
      '@test': resolve(__dirname, 'test'),
    },
  },
});