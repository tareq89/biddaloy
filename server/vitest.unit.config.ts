import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import swc from 'unplugin-swc';

/**
 * Vitest configuration for unit tests.
 * No database setup — these tests use mocked repositories.
 */
export default defineConfig({
  // See vitest.config.ts — SWC is needed so NestJS decorator metadata
  // (emitDecoratorMetadata) is actually emitted under Vitest.
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['src/**/*.integration.spec.ts', 'src/**/*.e2e-spec.ts'],
    environment: 'node',
    globals: true,

    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
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
      ],
      thresholds: {
        perFile: false,
        branches: 50,
        functions: 50,
        lines: 50,
        statements: 50,
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