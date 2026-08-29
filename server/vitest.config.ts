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
    // Test file patterns. `test/*.integration.spec.ts` (not `src/`) covers
    // this suite's own guard specs — e.g. reset-order.integration.spec.ts —
    // which validate test infrastructure itself, not application code.
    include: [
      'src/**/*.spec.ts',
      'src/**/*.integration.spec.ts',
      'src/**/*.e2e-spec.ts',
      'test/*.integration.spec.ts',
    ],

    // Environment
    environment: 'node',
    globals: true,

    // Runs once per `vitest run` invocation, before any spec file's worker
    // starts: migrates the schema and seeds baseline data exactly once
    // instead of once per spec file. See test/global-setup.ts.
    globalSetup: ['./test/global-setup.ts'],

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

    // Integration and E2E tests run sequentially — one file at a time — so
    // `clearTransactionalTables`'s DELETEs never race against each other on
    // the one shared Postgres test database, which produced real deadlocks
    // and "relation does not exist" failures otherwise.
    //
    // `fileParallelism: false` is the whole mechanism: Vitest's own docs say
    // it "will override `maxWorkers` option to `1`", so an explicit
    // `maxWorkers` here would be redundant. This previously also set
    // `poolOptions.threads.singleThread`, which Vitest 4 removed — it was a
    // no-op that only printed a DEPRECATED warning.
    pool: 'threads',
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@biddaloy/shared': resolve(__dirname, '../shared/src'),
      '@test': resolve(__dirname, 'test'),
    },
  },
});
