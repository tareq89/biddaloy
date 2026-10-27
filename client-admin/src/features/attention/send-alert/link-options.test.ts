/** [#2970] The alert "Page to open" list must mirror the portal nav. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PORTAL_PAGES } from './link-options';

const paths = PORTAL_PAGES.map(([to]) => to) as string[];

describe('PORTAL_PAGES', () => {
  it('includes Homework and Applications', () => {
    expect(paths).toContain('/portal/homework');
    expect(paths).toContain('/portal/applications');
  });

  it('lists every /portal page in routes/portal.tsx', () => {
    const src = readFileSync(resolve(__dirname, '../../../routes/portal.tsx'), 'utf8');
    const navPaths = [...src.matchAll(/to: '(\/portal[^']*)'/g)].map((m) => m[1]);
    expect(navPaths.length).toBeGreaterThan(5);
    for (const p of navPaths) expect(paths).toContain(p);
  });
});
