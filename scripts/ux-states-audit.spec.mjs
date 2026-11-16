// [#4283] ux-states-audit: strict gaps and stale exceptions.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { audit, EXCEPTIONS, withoutExceptions } from './ux-states-audit.mjs';

const FULL = `const data = useQuery(); const m = useMutation();
<Skeleton/><ErrorState/><EmptyState/><AccessDeniedState/>
<form><FormMessage/></form> toast.success('x');`;

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'uxs-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe('ux-states-audit', () => {
  it('a route with all states has no gaps', () => {
    expect(audit(fixture({ 'a.tsx': FULL }))).toEqual([]);
  });

  it('a missing ErrorState is a gap', () => {
    const gaps = audit(fixture({ 'a.tsx': FULL.replace('<ErrorState/>', '') }));
    expect(gaps).toEqual([{ route: 'a.tsx', state: 'error' }]);
  });

  it('a new route with a query and no states fails', () => {
    const gaps = audit(fixture({ 'b.tsx': 'useQuery()' }));
    expect(withoutExceptions(gaps).map((g) => `${g.route}|${g.state}`)).toContain('b.tsx|error');
  });

  it('helper, test and stories files are skipped', () => {
    const dir = fixture({ '-x.tsx': 'useQuery()', 'a.test.tsx': 'useQuery()', 'a.stories.tsx': 'useQuery()' });
    expect(audit(dir)).toEqual([]);
  });

  it('counts states from a one-level import', () => {
    const dir = fixture({
      'a.tsx': "import { V } from './-v';\nuseQuery()",
      '-v.tsx': '<Skeleton/><ErrorState/><EmptyState/><AccessDeniedState/>',
    });
    expect(audit(dir)).toEqual([]);
  });

  const A = 'const d = useQuery();';

  it('inline role=alert / ErrorText / aria-invalid counts as validation handling', () => {
    for (const ok of ['<p role="alert"/>', '<ErrorText/>', '<Input aria-invalid/>']) {
      expect(audit(fixture({ 'a.tsx': `<form>${ok}</form>` }))).toEqual([]);
    }
    expect(audit(fixture({ 'a.tsx': '<form></form>' }))).toEqual([{ route: 'a.tsx', state: 'validation' }]);
  });

  const BASE = `${A}<Skeleton/><ErrorState/><AccessDeniedState/><SearchInput/>`;

  it('a ListShell with filters covers empty and noResult', () => {
    const t = `${BASE}<ListShell\n  filters={{}}\n/>`;
    expect(audit(fixture({ 'a.tsx': t }))).toEqual([]);
  });

  it('a bare DataTable, or a legacy filterBar ListShell, still needs its states', () => {
    const bare = audit(fixture({ 'a.tsx': `${BASE}<DataTable/>` })).map((g) => g.state);
    expect(bare).toEqual(expect.arrayContaining(['empty', 'noResult']));
    const legacy = audit(fixture({ 'a.tsx': `${BASE}<ListShell\n  filterBar={x}\n/>` })).map((g) => g.state);
    expect(legacy).toEqual(['noResult']);
  });

  it('a bare q / search / filter identifier does not need noResult; a search box does', () => {
    const base = `${A}<Skeleton/><ErrorState/><EmptyState/><AccessDeniedState/>`;
    expect(audit(fixture({ 'a.tsx': `${base} const q = 1; const search = 2;` }))).toEqual([]);
    expect(audit(fixture({ 'a.tsx': `${base} <SearchInput/>` }))).toEqual([{ route: 'a.tsx', state: 'noResult' }]);
  });

  it('a layout file with an Outlet is skipped', () => {
    expect(audit(fixture({ 'a.tsx': `${A} <Outlet />` }))).toEqual([]);
  });

  it('a GuestStatus card is exempt from denied, empty, noResult and success, not from error', () => {
    const gaps = audit(fixture({ 'a.tsx': `${A} const m = useMutation(); <GuestStatus/> <Skeleton/>` }));
    expect(gaps).toEqual([{ route: 'a.tsx', state: 'error' }]);
  });

  it('exceptions drop a gap; every exception carries a reason', () => {
    const gaps = [{ route: 'a.tsx', state: 'error' }];
    expect(withoutExceptions(gaps, { 'a.tsx|error': 'why' })).toEqual([]);
    for (const reason of Object.values(EXCEPTIONS)) expect(reason.length).toBeGreaterThan(10);
  });
});
