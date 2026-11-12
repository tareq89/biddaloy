import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

function fakeJwt(): string {
  const payload = btoa(
    JSON.stringify({ memberships: [{ tenantId: 'tenant-1', role: 'ADMIN', name: 'Greenview' }] }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `h.${payload}.s`;
}

const future = new Date(Date.now() + 24 * 3600_000).toISOString();
const past = new Date(Date.now() - 3600_000).toISOString();

const request = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'ASK',
  ownerName: 'Owner',
  role: 'TEACHER',
  personName: 'Rahim',
  reason: 'Fee report looks wrong',
  requestedAt: new Date(Date.now() - 600_000).toISOString(),
  expiresAt: future,
  status: 'REQUESTED',
  ...over,
});

const PAGE_URL = '/support-access/requests/11111111-1111-4111-8111-111111111111';

/** Status-aware like the API: `pending` returns waiting requests, `decided` the rest. */
function mockList(items: unknown[]) {
  const queries: string[] = [];
  server.use(
    http.get('/api/v1/support-access/requests', ({ request: req }) => {
      const url = new URL(req.url);
      queries.push(`${url.searchParams.get('status')}:${url.searchParams.get('limit')}`);
      const waiting = url.searchParams.get('status') === 'pending';
      return HttpResponse.json(
        items.filter((i) => ((i as { status: string }).status === 'REQUESTED') === waiting),
      );
    }),
  );
  return queries;
}

function mockDecision(decision: 'approve' | 'deny') {
  const posted = vi.fn();
  server.use(
    http.post(`/api/v1/support-access/requests/:id/${decision}`, ({ params }) => {
      posted(params.id);
      return HttpResponse.json({
        id: params.id,
        status: decision === 'approve' ? 'APPROVED' : 'DENIED',
      });
    }),
  );
  return posted;
}

function render() {
  return renderWithRouter(routeTree, {
    initialEntries: [PAGE_URL],
    accessToken: fakeJwt(),
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

afterEach(async () => {
  await cleanupTestState();
});

describe('/support-access/requests/$requestId', () => {
  it('shows who asks, why and for how long, and opening it changes nothing', async () => {
    mockList([request()]);
    const approve = mockDecision('approve');
    const deny = mockDecision('deny');
    const { container } = render();

    expect(
      await screen.findByRole('heading', {
        name: 'Biddaloy support asks to log in as Rahim (Teacher).',
      }),
    ).toBeTruthy();
    expect(screen.getByText('Fee report looks wrong')).toBeTruthy();
    expect(screen.getByText(/Valid until/)).toBeTruthy();
    expect(screen.getByText('First answer counts.')).toBeTruthy();
    await expect(container).toHaveNoViolations();
    expect(approve).not.toHaveBeenCalled();
    expect(deny).not.toHaveBeenCalled();
  });

  it('Approve posts approve and shows the result in place of the buttons', async () => {
    mockList([request()]);
    const posted = mockDecision('approve');
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Approved. Biddaloy support can log in now.')).toBeTruthy();
    expect(posted).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('Not now posts deny', async () => {
    mockList([request()]);
    const posted = mockDecision('deny');
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(await screen.findByText('Not now. Biddaloy support was told.')).toBeTruthy();
    expect(posted).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['APPROVED', 'This request was already approved.'],
    ['DENIED', 'This request was already answered with Not now.'],
    ['EXPIRED', 'This request has run out. Biddaloy support can ask again.'],
  ])('a %s request shows its result and no buttons', async (status, text) => {
    mockList([request({ status })]);
    render();

    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });

  it('finds an answered request only through the decided list, asking for 100 of each', async () => {
    const queries = mockList([request({ status: 'APPROVED' })]);
    render();

    expect(await screen.findByText('This request was already approved.')).toBeTruthy();
    expect(queries).toContain('pending:100');
    expect(queries).toContain('decided:100');
  });

  it('a waiting request past its end time reads as run out', async () => {
    mockList([request({ expiresAt: past })]);
    render();

    expect(await screen.findByText(/This request has run out/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it("a link for another school's request (not in this school's list) says not found", async () => {
    mockList([]);
    render();

    expect(await screen.findByText('We could not find this request.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('the emergency write variant reads as view only now', async () => {
    mockList([request({ kind: 'WRITE' })]);
    render();

    expect(
      await screen.findByRole('heading', {
        name: 'Biddaloy support asks to make changes (view only now).',
      }),
    ).toBeTruthy();
  });

  it('a failed answer shows an error and keeps the buttons', async () => {
    mockList([request()]);
    server.use(
      http.post('/api/v1/support-access/requests/:id/approve', () =>
        HttpResponse.json({ statusCode: 409, message: 'x', requestId: 'r' }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Could not send your answer. Try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });
});
