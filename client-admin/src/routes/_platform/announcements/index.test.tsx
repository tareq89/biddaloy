import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const SENT = {
  id: 'an-1',
  title: 'Planned maintenance',
  severity: 'REMINDER',
  statusFilter: ['ACTIVE'],
  sms: false,
  email: false,
  schoolsTargeted: 4,
  schoolsSucceeded: 4,
  recipientCount: 6,
  createdByName: 'Owner One',
  createdAt: '2029-12-31T00:00:00.000Z',
};
const REQUESTED = {
  statusCode: 403,
  message: 'x',
  timestamp: '',
  path: '/',
  requestId: 'r',
  details: { code: 'APPROVAL_REQUESTED', requestId: 'ap-1' },
};
const approval = (status: string) => ({
  id: 'ap-1',
  scope: 'platform.announce_all',
  summary: {},
  status,
  requested_by: 'o1',
  decided_by: null,
  decided_at: null,
  expires_at: '2030-01-01T00:00:00.000Z',
  created_at: '2029-12-31T00:00:00.000Z',
});

/** Serves the page; returns what it was asked (previews, sends with their headers). */
function serve(opts: { approvalStatus?: string; items?: object[] } = {}) {
  const previews: unknown[] = [];
  const calls = { list: 0 };
  const sends: { body: Record<string, unknown>; key: string | null; approval: string | null }[] =
    [];
  server.use(
    http.get('*/platform/announcements', () => {
      calls.list += 1;
      return HttpResponse.json({
        items: opts.items ?? [SENT],
        total: (opts.items ?? [SENT]).length,
      });
    }),
    http.post('*/platform/announcements/preview', async ({ request }) => {
      const body = (await request.json()) as { statusFilter: string[] };
      previews.push(body.statusFilter);
      return HttpResponse.json(
        { schools: body.statusFilter.length === 2 ? 9 : 4, people: 6 },
        { status: 200 },
      );
    }),
    http.post('*/platform/announcements', async ({ request }) => {
      const approvalHeader = request.headers.get('X-Platform-Approval');
      sends.push({
        body: (await request.json()) as Record<string, unknown>,
        key: request.headers.get('Idempotency-Key'),
        approval: approvalHeader,
      });
      return approvalHeader
        ? HttpResponse.json(SENT, { status: 201 })
        : HttpResponse.json(REQUESTED, { status: 403 });
    }),
    http.get('*/platform/approvals', () =>
      HttpResponse.json(
        opts.approvalStatus === 'NONE' ? [] : [approval(opts.approvalStatus ?? 'PENDING')],
      ),
    ),
  );
  return { previews, sends, calls };
}
const render = () =>
  renderWithRouter(routeTree, {
    initialEntries: ['/announcements'],
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    locale: 'en',
  });

async function fill(user: ReturnType<typeof userEvent.setup>) {
  // Send stays off until the count is ready.
  await screen.findByText('Schools: 4. Admins: 6.');
  await user.type(await screen.findByLabelText('Title'), 'Planned maintenance');
  await user.type(screen.getByLabelText('Message'), 'We restart at midnight.');
}

afterEach(async () => {
  sessionStorage.removeItem('biddaloy:announcementPending');
  await cleanupTestState();
});

describe('/announcements', () => {
  it('shows the count and says the other owner must agree', async () => {
    serve();
    render();
    expect(await screen.findByText('Schools: 4. Admins: 6.')).toBeTruthy();
    expect(screen.getByText('The other owner must agree before it is sent.')).toBeTruthy();
  });

  it('the preview follows the school filter', async () => {
    const { previews } = serve();
    const user = userEvent.setup();
    render();
    await screen.findByText('Schools: 4. Admins: 6.');
    await user.click(screen.getByLabelText('Send to'));
    await user.click(await screen.findByRole('option', { name: 'All schools' }));
    expect(await screen.findByText('Schools: 9. Admins: 6.')).toBeTruthy();
    expect(previews).toEqual([['ACTIVE'], ['ACTIVE', 'SUSPENDED']]);
  });

  it('send posts the body, shows the waiting card and freezes the form', async () => {
    const { sends } = serve();
    const user = userEvent.setup();
    render();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Waiting for the other owner to agree/)).toBeTruthy();
    expect(sends).toHaveLength(1);
    expect(sends[0]!.body).toMatchObject({
      title: 'Planned maintenance',
      body: 'We restart at midnight.',
      severity: 'REMINDER',
      statusFilter: ['ACTIVE'],
      sms: false,
      email: false,
    });
    expect(screen.getByLabelText<HTMLInputElement>('Title').disabled).toBe(true);
  });

  it('a double click sends once', async () => {
    const { sends } = serve();
    const user = userEvent.setup();
    render();
    await fill(user);
    await user.dblClick(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Waiting for the other owner to agree/);
    expect(sends).toHaveLength(1);
  });

  it('when the other owner agrees it re-sends the same key with the approval and shows Sent', async () => {
    const { sends } = serve();
    const user = userEvent.setup();
    render();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Waiting for the other owner to agree/);
    server.use(http.get('*/platform/approvals', () => HttpResponse.json([approval('GRANTED')])));
    // "Send now" is the same re-send the poll triggers by itself.
    await waitFor(() => expect(sends.length).toBeGreaterThan(1), { timeout: 8000 });
    expect(await screen.findByText('Sent to 4 schools and 6 people.')).toBeTruthy();
    expect(sends[1]!.approval).toBe('ap-1');
    expect(sends[1]!.key).toBe(sends[0]!.key);
    expect(sends[1]!.body).toEqual(sends[0]!.body);
  }, 15000);

  it('a waiting approval survives leaving the page: on return a granted one is sent', async () => {
    const { sends } = serve({ approvalStatus: 'GRANTED' });
    sessionStorage.setItem(
      'biddaloy:announcementPending',
      JSON.stringify({
        input: {
          statusFilter: ['ACTIVE'],
          title: 'Planned maintenance',
          body: 'We restart.',
          severity: 'REMINDER',
          sms: false,
          email: false,
        },
        approvalId: 'ap-1',
        at: Date.now(),
      }),
    );
    render();

    await waitFor(() => expect(sends).toHaveLength(1));
    expect(sends[0]!.approval).toBe('ap-1');
    expect(sends[0]!.body).toMatchObject({ title: 'Planned maintenance' });
    expect(await screen.findByText('Sent to 4 schools and 6 people.')).toBeTruthy();
    expect(sessionStorage.getItem('biddaloy:announcementPending')).toBeNull();
  });

  it('the list pages: more than 25 announcements shows a next page', async () => {
    const offsets: (string | null)[] = [];
    serve();
    server.use(
      http.get('*/platform/announcements', ({ request }) => {
        offsets.push(new URL(request.url).searchParams.get('offset'));
        return HttpResponse.json({ items: [SENT], total: 60 });
      }),
    );
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: /next/i }));
    await waitFor(() => expect(offsets).toContain('25'));
  });

  async function sendAndWait(user: ReturnType<typeof userEvent.setup>) {
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send' }));
  }

  it('says so when the request ran out of time, and unlocks the form', async () => {
    serve({ approvalStatus: 'EXPIRED' });
    const user = userEvent.setup();
    render();
    await sendAndWait(user);
    expect(await screen.findByText('The request ran out of time. Nothing was sent.')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Title').disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('a request already used is not waited for: list refreshes, note shows, form unlocks', async () => {
    const { calls } = serve({ approvalStatus: 'USED' });
    const user = userEvent.setup();
    render();
    await sendAndWait(user);
    expect(
      await screen.findByText('This request was already sent. See the list below.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Waiting for the other owner/)).toBeNull();
    expect(calls.list).toBeGreaterThan(1);
    expect(screen.getByLabelText<HTMLInputElement>('Title').disabled).toBe(false);
  });

  it('a request missing from the list is not waited for forever', async () => {
    serve({ approvalStatus: 'NONE' });
    const user = userEvent.setup();
    render();
    await sendAndWait(user);
    expect(await screen.findByText(/This request can no longer be found/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Title').disabled).toBe(false);
  });

  it('closing the code prompt on the auto re-send keeps Send now and does not retry by itself', async () => {
    const sends: (string | null)[] = [];
    serve({ approvalStatus: 'GRANTED' });
    server.use(
      http.post('*/platform/announcements', ({ request }) => {
        const header = request.headers.get('X-Platform-Approval');
        sends.push(header);
        return header
          ? HttpResponse.json(
              { ...REQUESTED, details: { code: 'APPROVAL_REQUIRED' } },
              { status: 403 },
            )
          : HttpResponse.json(REQUESTED, { status: 403 });
      }),
    );
    const user = userEvent.setup();
    render();
    await sendAndWait(user);
    await screen.findByLabelText('Authenticator code');
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'Send now' })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));
    expect(sends).toEqual([null, 'ap-1']);
  });

  it('says so when the other owner said no', async () => {
    serve({ approvalStatus: 'DENIED' });
    const user = userEvent.setup();
    render();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('The other owner said no. Nothing was sent.')).toBeTruthy();
  });

  it('lists sent announcements, and says so when there are none', async () => {
    serve();
    render();
    expect(await screen.findAllByText('Planned maintenance')).toBeTruthy();
    expect(screen.getAllByText('Owner One').length).toBeGreaterThan(0);
    expect(screen.getAllByText('4 of 4 schools').length).toBeGreaterThan(0);
  });

  it('empty list', async () => {
    serve({ items: [] });
    render();
    expect(await screen.findByText('No announcements yet')).toBeTruthy();
  });

  it('shows an error sentence when the list fails to load', async () => {
    serve();
    server.use(
      http.get('*/platform/announcements', () =>
        HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 }),
      ),
    );
    render();
    expect(await screen.findByText('Could not load the announcements. Try again.')).toBeTruthy();
  });

  it('a failed count lets the owner count again and blocks nothing silently', async () => {
    serve();
    server.use(
      http.post('*/platform/announcements/preview', () =>
        HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 }),
      ),
    );
    render();
    expect(await screen.findByText('Could not count. Try again.')).toBeTruthy();
  });
});

describe('platformAnnouncements locale', () => {
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
    walk(JSON.parse(readFileSync(`${root}/${locale}/platformAnnouncements.json`, 'utf8')));
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
