import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Contract test [#3000, Rule 23/24]: no `${...}` inside the message of a
 * `new NotFoundException(...)`.
 *
 * Why: a 404 that repeats the id (or any value the caller sent) echoes input.
 * A 404 says only what was missing: `Exam not found`.
 *
 * Fixing a failure: drop the `${...}` and use one fixed sentence. There is no
 * allowlist; a NotFound never needs to name the record.
 *
 * Known blind spots (not caught):
 *   - message built into a variable first, then passed in
 *   - string concatenation as the message
 * ponytail: NotFound only. Conflict and BadRequest still carry reviewed
 * server-state interpolation (a status, a count); widen with an allowlist then.
 *
 * Skips `*.spec.ts`, `*.e2e-spec.ts` and `src/migrations/**`.
 */
const NOT_FOUND_WITH_INTERPOLATION =
  /new NotFoundException\(\s*(?:\{\s*message:\s*)?\x60[^\x60]*\$\{/g;

const SRC_DIR = __dirname;

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const fullPath = join(dir, name);
    if (statSync(fullPath).isDirectory()) {
      if (relative(SRC_DIR, fullPath) === 'migrations') continue;
      files.push(...collectFiles(fullPath));
    } else if (
      name.endsWith('.ts') &&
      !name.endsWith('.spec.ts') &&
      !name.endsWith('.e2e-spec.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('NotFoundException messages never echo input', () => {
  it('has no ${...} in any NotFoundException message', () => {
    const found: string[] = [];
    for (const file of collectFiles(SRC_DIR)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(NOT_FOUND_WITH_INTERPOLATION)) {
        const line = text.slice(0, match.index).split('\n').length;
        found.push(`${relative(SRC_DIR, file)}:${line}`);
      }
    }
    expect(found).toEqual([]);
  });
});
