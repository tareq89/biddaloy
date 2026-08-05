import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'eslint-rules/**/*.spec.mjs'],
    environment: 'node',
    globals: true,
  },
});
