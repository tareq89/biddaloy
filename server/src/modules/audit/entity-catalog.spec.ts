import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { AUDIT_ENTITY_TYPES } from '@biddaloy/shared';

/**
 * Contract test: `AUDIT_ENTITY_TYPES` (shared/src/audit/entity-types.ts) is
 * the single source of truth for `entity_type` literals written under
 * `server/src`. This test fails if the two ever drift in either direction —
 * a literal the server writes that isn't in the catalog (a filter option
 * the client can never show), or a catalog entry no server code writes
 * anymore (dead option in the client filter).
 *
 * Walks the filesystem directly (not `rg`) so this test has no external
 * tool dependency and runs the same in CI as locally.
 */
const ENTITY_TYPE_LITERAL = /entity_type:\s*'([A-Za-z_]+)'/g;

function collectServerSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectServerSourceFiles(fullPath));
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectWrittenEntityTypes(serverSrcDir: string): Set<string> {
  const found = new Set<string>();
  for (const file of collectServerSourceFiles(serverSrcDir)) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(ENTITY_TYPE_LITERAL)) {
      found.add(match[1]);
    }
  }
  return found;
}

describe('audit entity-type catalog contract', () => {
  const serverSrcDir = join(__dirname, '..', '..');

  it('contains every entity_type literal written under server/src', () => {
    const written = collectWrittenEntityTypes(serverSrcDir);
    const catalog = new Set<string>(AUDIT_ENTITY_TYPES);

    const missingFromCatalog = [...written].filter((type) => !catalog.has(type));
    expect(missingFromCatalog).toEqual([]);
  });

  it('has no dead catalog entries — every entry is written somewhere under server/src', () => {
    const written = collectWrittenEntityTypes(serverSrcDir);

    const deadEntries = AUDIT_ENTITY_TYPES.filter((type) => !written.has(type));
    expect(deadEntries).toEqual([]);
  });
});
