import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const ROW = {
  id: 'a1',
  action: 'UPDATE',
  entityType: 'FeeHead',
  schoolName: 'Rose Valley School',
  tenantId: 't1',
  actorName: 'Rahim',
  impersonatedByName: 'Owner One',
  sessionId: 'v1',
  at: '2029-12-31T00:00:00.000Z',
};
const VISIT = {
  id: 'v1',
  ownerId: 'o1',
  ownerName: 'Owner One',
  schoolId: 't1',
  schoolName: 'Rose Valley School',
  role: 'TEACHER',
  personName: 'Rahim',
  reason: 'Bug check',
  entryKind: 'NORMAL',
  startedAt: '2029-12-31T00:00:00.000Z',
  endedAt: '2029-12-31T00:10:00.000Z',
  status: 'ENDED',
  changedCount: 1,
};

/** Every audit request the page makes, as its query string. */
function serve(auditPages: { items: object[]; nextCursor: string | null }[] = []) {
  const audit: URLSearchParams[] = [];
  server.use(
    http.get('*/platform/audit/sessions', () =>
      HttpResponse.json({ items: [VISIT], nextCursor: null }),
    ),
    http.get('*/platform/audit', ({ request }) => {
      const q = new URL(request.url).searchParams;
      audit.push(q);
      const page = q.get('cursor') ? auditPages[1] : auditPages[0];
      return HttpResponse.json(page ?? { items: [ROW], nextCursor: null });
    }),
  );
  return audit;
}
const render = (url = '/audit') =>
  renderWithRouter(routeTree, {
    initialEntries: [url],
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    locale: 'en',
  });

afterEach(async () => {
  await cleanupTestState();
});

describe('/audit', () => {
  it('reads filters from the URL into the query, and caps the limit at 100', async () => {
    const audit = serve();
    render('/audit?tenantId=t1&action=UPDATE&sessionId=v1&from=2029-12-01&limit=500');
    await screen.findAllByText('Biddaloy support (as Rahim)');
    const q = audit[0]!;
    expect(q.get('tenantId')).toBe('t1');
    expect(q.get('action')).toBe('UPDATE');
    expect(q.get('sessionId')).toBe('v1');
    expect(q.get('from')).toMatch(/^2029-1[12]-/);
    // An out of range limit is dropped, and the hook clamps whatever is left.
    expect(Number(q.get('limit'))).toBeLessThanOrEqual(100);
  });

  it('pages by cursor and returns to the first page', async () => {
    const audit = serve([
      { items: [ROW], nextCursor: 'CUR2' },
      {
        items: [{ ...ROW, id: 'a2', actorName: 'Karim', impersonatedByName: null }],
        nextCursor: null,
      },
    ]);
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: 'Next page' }));
    await screen.findAllByText('Karim');
    expect(audit.at(-1)!.get('cursor')).toBe('CUR2');
    await user.click(screen.getByRole('button', { name: 'First page' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'First page' })).toBeNull());
    // The first page comes back from the cache, so the button for the next one is back.
    expect(await screen.findByRole('button', { name: 'Next page' })).toBeTruthy();
    expect(audit[0]!.get('cursor')).toBeNull();
  });

  it('opening a visit filters All activity by that visit', async () => {
    const audit = serve();
    const user = userEvent.setup();
    render('/audit?tab=visits');
    const open = (
      await screen.findAllByRole('button', { name: /See all activity of the visit as Rahim/ })
    )[0]!;
    await user.click(open);
    await screen.findAllByText('Biddaloy support (as Rahim)');
    expect(audit.at(-1)!.get('sessionId')).toBe('v1');
  });

  it('shows an error sentence when the audit fails to load', async () => {
    server.use(
      http.get('*/platform/audit', () =>
        HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 }),
      ),
    );
    render();
    expect(await screen.findByText('Could not load the audit. Try again.')).toBeTruthy();
  });
});

describe('platformAudit locale', () => {
  // Never-say words, docs/ux-research/tenant-control-glossary.md (D14).
  const NEVER = [
    'impersonate',
    'act as',
    'break-glass',
    'consent',
    'session',
    'revoke',
    'kill',
    'mode',
    'policy',
    'justification',
    'user_id',
  ];
  const root = resolve(__dirname, '../../../../../ui/src/i18n/locales');
  const strings = (locale: string): string[] => {
    const out: string[] = [];
    const walk = (v: unknown) =>
      typeof v === 'string' ? out.push(v) : Object.values(v as object).forEach(walk);
    walk(JSON.parse(readFileSync(`${root}/${locale}/platformAudit.json`, 'utf8')));
    return out;
  };

  it.each(['en', 'bn'])('%s has no never-say word', (locale) => {
    const text = strings(locale).join('\n').toLowerCase();
    for (const word of NEVER) expect(text, word).not.toMatch(new RegExp(`\\b${word}\\b`));
  });

  it('bn and en have the same number of strings', () => {
    expect(strings('bn')).toHaveLength(strings('en').length);
  });
});
