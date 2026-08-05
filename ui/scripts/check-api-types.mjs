#!/usr/bin/env node
/**
 * Fail if the checked-in schema.d.ts does not match a fresh generation from
 * server/openapi.json.
 *
 * The whole point of generating client types from the server's own OpenAPI
 * document is that the frontend cannot silently drift from what the server
 * actually serves. That guarantee only holds if CI catches the case where
 * someone changes an endpoint and forgets to re-run `yarn api:types`.
 *
 * Invoked via a version-pinned `npx`, the same pattern [8.1.3] uses for the
 * shadcn CLI, rather than installed as a real workspace devDependency:
 * `openapi-typescript`'s transitive `@redocly/openapi-core` pins
 * `js-yaml@4.3.0` exactly, which conflicts outright with this repo's root
 * `resolutions.js-yaml: ^5.2.2` (a security-motivated bump, already merged —
 * see PR #85). Installing it for real means yarn's hoisting forces every
 * consumer, including this one, onto 5.x, and `@redocly/openapi-core`'s own
 * js-yaml usage breaks immediately (`Cannot read properties of undefined
 * (reading 'merge')` — 5.x's API shape). `npx` resolves its own isolated
 * copy, sidestepping the workspace's resolutions entirely. openapi-typescript
 * only ever runs against this repo's own generated openapi.json, never
 * untrusted input, so the security reasoning behind the 5.x bump does not
 * apply to this tool the way it does elsewhere.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkedIn = join(pkgRoot, 'src', 'api', 'schema.d.ts');
const openapiJson = join(pkgRoot, '..', 'server', 'openapi.json');

const tmpDir = mkdtempSync(join(tmpdir(), 'beton-boi-api-types-'));
const fresh = join(tmpDir, 'schema.d.ts');

try {
  execFileSync(
    'npx',
    ['--yes', 'openapi-typescript@7.13.0', openapiJson, '-o', fresh],
    { stdio: 'inherit' },
  );

  const checkedInContent = readFileSync(checkedIn, 'utf8');
  const freshContent = readFileSync(fresh, 'utf8');

  if (checkedInContent !== freshContent) {
    console.error(
      'check-api-types: FAILED\n\n' +
        '  src/api/schema.d.ts does not match a fresh generation from ' +
        'server/openapi.json.\n' +
        '  Run `yarn workspace @beton-boi/ui api:types` and commit the result.',
    );
    process.exit(1);
  }

  console.log('check-api-types: OK — schema.d.ts matches server/openapi.json.');
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
