import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import swc from 'unplugin-swc';

export default defineConfig({
  // esbuild (Vite/Vitest's default TS transform) does not emit
  // `emitDecoratorMetadata` output, so NestJS can't reflect `@Body()`
  // parameter types — ValidationPipe silently skips validation on every
  // DTO. SWC does emit it; this is the standard NestJS+Vitest fix.
  plugins: [swc.vite()],
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
    setupFiles: ['./test/setup.ts'],

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
        'src/modules/auth/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
        'src/**/*.guard.ts': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'src/**/*.repository.ts': { statements: 85, branches: 85, functions: 85, lines: 85 },
        'src/**/*.service.ts': { statements: 85, branches: 85, functions: 85, lines: 85 },
        'src/**/*.controller.ts': { statements: 60, branches: 60, functions: 60, lines: 60 },
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