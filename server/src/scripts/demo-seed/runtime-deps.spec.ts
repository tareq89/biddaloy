import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { builtinModules } from 'module';
import { join } from 'path';

// The nightly demo reset runs the built seed in the production image, which installs
// `dependencies` only (Dockerfile `--production`). A seed import that lives only in a
// root devDependency (as @faker-js/faker did, PR #2515 review r3 F1) dies there with
// "Cannot find module". So every package the seed imports at runtime must be declared
// in server/package.json or shared/package.json `dependencies`.
const pkg = (path: string) => JSON.parse(readFileSync(join(__dirname, path), 'utf8'));
const declared = new Set([
  ...Object.keys(pkg('../../../package.json').dependencies),
  ...Object.keys(pkg('../../../../shared/package.json').dependencies),
  '@biddaloy/shared',
]);

function seedSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? seedSources(join(dir, e.name))
      : e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')
        ? [join(dir, e.name)]
        : [],
  );
}

describe('demo seed runtime imports', () => {
  it('come only from production dependencies or node built-ins', () => {
    const missing: string[] = [];
    for (const file of seedSources(__dirname)) {
      // `import type` is erased at build time, so it needs no runtime package.
      for (const m of readFileSync(file, 'utf8').matchAll(
        /^import (?!type )[^;]*?from '([^.'][^']*)'/gm,
      )) {
        const spec = m[1].replace(/^node:/, '');
        const name = spec.startsWith('@')
          ? spec.split('/').slice(0, 2).join('/')
          : spec.split('/')[0];
        if (!declared.has(name) && !builtinModules.includes(name))
          missing.push(`${name} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
