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

/** Like the API: `GET /requests/:id` finds this school's request or answers 404. Counts list calls. */
function mockList(items: unknown[]) {
  const calls = { byId: 0, list: 0 };
  server.use(
    http.get('/api/v1/support-access/requests/:id', ({ params }) => {
      calls.byId += 1;
      const hit = items.find((i) => (i as { id: string }).id === params.id);
      return hit
        ? HttpResponse.json(hit)
        : HttpResponse.json(
            { statusCode: 404, message: 'x', timestamp: '', path: '/', requestId: 'r' },
            { status: 404 },
          );
    }),
    http.get('/api/v1/support-access/requests', () => {
      calls.list += 1;
      return HttpResponse.json([]);
    }),
  );
  return calls;
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

  it('a decision on one request is not shown on another request', async () => {
    const other = '22222222-2222-4222-8222-222222222222';
    mockList([request(), request({ id: other, personName: 'Karim' })]);
    mockDecision('approve');
    const user = userEvent.setup();
    const { router } = render();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await screen.findByText('Approved. Biddaloy support can log in now.');
    await router.navigate({
      to: '/support-access/requests/$requestId',
      params: { requestId: other },
    });

    expect(await screen.findByRole('heading', { name: /Karim/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.queryByText('Approved. Biddaloy support can log in now.')).toBeNull();
  });

  it('writes the role in the language of the page', async () => {
    mockList([request()]);
    renderWithRouter(routeTree, {
      initialEntries: [PAGE_URL],
      accessToken: fakeJwt(),
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'bn',
    });

    expect(await screen.findByRole('heading', { name: /শিক্ষক/ })).toBeTruthy();
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

  it('loads the request by id, never through a capped list', async () => {
    const calls = mockList([request({ status: 'APPROVED' })]);
    render();

    expect(await screen.findByText('This request was already approved.')).toBeTruthy();
    expect(calls.byId).toBe(1);
    expect(calls.list).toBe(0);
  });

  it('a failed load shows an error with Retry, not "not found"', async () => {
    server.use(
      http.get('/api/v1/support-access/requests/:id', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'x', timestamp: '', path: '/', requestId: 'r' },
          { status: 500 },
        ),
      ),
    );
    render();

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('We could not find this request.')).toBeNull();
  });

  it('a waiting request past its end time reads as run out', async () => {
    mockList([request({ expiresAt: past })]);
    render();

    expect(await screen.findByText(/This request has run out/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it("a link for another school's request (the server answers 404) says not found", async () => {
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
