import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Epic 77 D19/D49: a converted namespace never gets a bare stock word back
// (Class, Section, Student, Guardian, Teacher / শ্রেণি, শাখা, ...). The rules live in the
// codemod; this runs its --check. Intentional leftovers are listed with a reason under
// `allow` in scripts/codemods/entity-words.converted.json ("lang:ns:path" -> why).
const root = resolve(__dirname, '../../..');
const script = resolve(root, 'scripts/codemods/entity-words.mjs');
const state = resolve(root, 'scripts/codemods/entity-words.converted.json');

describe('entity-word coverage', () => {
  it('has a converted list', () => {
    expect(existsSync(state)).toBe(true);
    const json = JSON.parse(readFileSync(state, 'utf8')) as {
      converted: string[];
      allow: Record<string, string>;
    };
    expect(json.converted.length).toBeGreaterThan(0);
    for (const [id, reason] of Object.entries(json.allow))
      expect(reason.length, id).toBeGreaterThan(3);
  });

  it('no bare stock word in a converted namespace', () => {
    const r = spawnSync('node', [script, '--check'], { encoding: 'utf8' });
    expect(r.stderr, 'bare words left; run the codemod or allow-list them').toBe('');
    expect(r.status).toBe(0);
  });
});
