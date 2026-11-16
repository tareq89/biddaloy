import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * [Epic 60 #4009, D19] Security rule "Document uploads are virus-scanned".
 *
 * Every non-spec file under `server/src/modules` that checks an upload's bytes with
 * `matchesDeclaredType(` must also call `assertClean(`, or be listed below with the reason.
 * A new upload route that forgets the scan turns this test red.
 *
 *   checks a signature, no scan, not listed -> RED
 *   listed but now scans (or stopped checking) -> RED (the list may only shrink)
 */
const MODULES = resolve(__dirname, '..');

/** Files that check a signature but need no scan. Each has its reason. */
const IMAGE_ONLY: Record<string, string> = {
  'storage/file-signature.ts': 'defines matchesDeclaredType; no upload route',
  'website/site-media.service.ts':
    'picture only; sharp decodes it and re-encodes WebP, so no original bytes are stored',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') && !full.endsWith('.e2e-spec.ts')
      ? [full]
      : [];
  });
}

const rel = (f: string) => relative(MODULES, f).split(sep).join('/');
const checked = sourceFiles(MODULES)
  .filter((f) => readFileSync(f, 'utf8').includes('matchesDeclaredType('))
  .map((f) => ({ file: rel(f), scans: readFileSync(f, 'utf8').includes('assertClean(') }));

describe('upload scan guard (Rule: document uploads are virus-scanned)', () => {
  it('finds the upload services (the scan below is not looking at an empty list)', () => {
    expect(checked.length).toBeGreaterThanOrEqual(7);
  });

  it('every file that checks an upload signature also calls assertClean, or is IMAGE_ONLY', () => {
    const missing = checked.filter((c) => !c.scans && !(c.file in IMAGE_ONLY)).map((c) => c.file);
    expect(missing, `call virusScan.assertClean(...) in: ${missing.join(', ')}`).toEqual([]);
  });

  it('IMAGE_ONLY lists only files that still check a signature and still skip the scan', () => {
    const stale = Object.keys(IMAGE_ONLY).filter((f) => {
      const c = checked.find((x) => x.file === f);
      return !c || c.scans;
    });
    expect(stale, `remove from IMAGE_ONLY: ${stale.join(', ')}`).toEqual([]);
  });
});
