import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SupportAccessSection } from './SupportAccessSection';
import { WithTestRouter } from './with-test-router';

const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: 'school-1' };

const settings = (mode: 'allowed' | 'ask' | 'blocked') => ({
  mode,
  confirmedAt: null,
  confirmedByName: null,
  textVersion: 1,
  currentTextVersion: 1,
  needsConfirmation: false,
});

const session = {
  id: 's1',
  ownerName: 'Owner',
  startedAt: '2026-11-10T10:00:00.000Z',
  endedAt: null,
  status: 'ACTIVE',
  kind: 'NORMAL',
  viewOnly: false,
  role: 'TEACHER',
  personName: 'Rahim',
  reason: 'Bug check',
  changedCount: 3,
};

function mockApi(
  mode: 'allowed' | 'ask' | 'blocked' = 'ask',
  over: { sessions?: unknown[]; actions?: unknown[]; requests?: unknown[] } = {},
) {
  server.use(
    http.get('/api/v1/support-access/settings', () => HttpResponse.json(settings(mode))),
    http.get('/api/v1/support-access/sessions', () => HttpResponse.json(over.sessions ?? [])),
    http.get('/api/v1/support-access/platform-actions', () =>
      HttpResponse.json(over.actions ?? []),
    ),
    http.get('/api/v1/support-access/requests', () => HttpResponse.json(over.requests ?? [])),
  );
}

function renderSection() {
  return renderWithProviders(
    <WithTestRouter>
      <SupportAccessSection />
    </WithTestRouter>,
    opts,
  );
}

function captureMode() {
  const body = vi.fn();
  server.use(
    http.put('/api/v1/support-access/settings', async ({ request }) => {
      body(await request.json());
      return HttpResponse.json(settings('allowed'));
    }),
  );
  return body;
}

describe('SupportAccessSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the three choices with the saved one checked, and the emergency sentence', async () => {
    mockApi('ask');
    renderSection();

    const ask = await screen.findByRole('radio', { name: /Ask each time/ });
    expect(ask.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /Allowed/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Blocked/ })).toBeTruthy();
    expect(screen.getByText(/Emergency access still exists/)).toBeTruthy();
  });

  it.each([
    ['Allowed', 'allowed', 'ask'],
    ['Ask each time', 'ask', 'allowed'],
  ] as const)('%s saves %s', async (name, value, from) => {
    mockApi(from);
    const body = captureMode();
    const { user } = renderSection();

    await user.click(await screen.findByRole('radio', { name: new RegExp(name) }));
    expect(screen.getByText(/^Saving (lets|makes|stops)/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toHaveBeenCalledWith({ mode: value }));
  });

  it('blocked warns that logged-in people end now, and saves only after confirming', async () => {
    mockApi('allowed');
    const body = captureMode();
    const { user } = renderSection();

    await user.click(await screen.findByRole('radio', { name: /Blocked/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/will be ended at once/)).toBeTruthy();
    expect(body).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Block' }));

    await waitFor(() => expect(body).toHaveBeenCalledWith({ mode: 'blocked' }));
  });

  it('shows an error when saving fails', async () => {
    mockApi('allowed');
    server.use(
      http.put('/api/v1/support-access/settings', () =>
        HttpResponse.json({ statusCode: 500, message: 'x', requestId: 'r' }, { status: 500 }),
      ),
    );
    const { user } = renderSection();

    await user.click(await screen.findByRole('radio', { name: /Ask each time/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Try again.');
  });

  it('lists requests waiting with an Open link to the request page', async () => {
    mockApi('ask', {
      requests: [
        {
          id: 'r1',
          kind: 'ASK',
          ownerName: 'Owner',
          role: 'TEACHER',
          personName: 'Rahim',
          reason: 'Fee report looks wrong',
          requestedAt: '2026-11-11T10:00:00.000Z',
          expiresAt: null,
          status: 'REQUESTED',
        },
      ],
    });
    renderSection();

    const open = await screen.findByRole('link', { name: 'Open' });
    expect(open.getAttribute('href')).toBe('/support-access/requests/r1');
    expect(screen.getByText('Biddaloy support asks to log in as Rahim (Teacher).')).toBeTruthy();
  });

  it('End on a live row asks first, then calls the end route', async () => {
    mockApi('allowed', { sessions: [session] });
    const ended = vi.fn();
    server.use(
      http.post('/api/v1/support-access/sessions/:id/end', ({ params }) => {
        ended(params.id);
        return HttpResponse.json({ id: 's1', status: 'ENDED' });
      }),
    );
    const { user } = renderSection();

    await user.click(await screen.findByRole('button', { name: /^End/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(ended).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'End' }));

    await waitFor(() => expect(ended).toHaveBeenCalledWith('s1'));
  });

  it('does not say "No requests waiting" while loading or when the request list fails', async () => {
    mockApi('ask');
    server.use(
      http.get('/api/v1/support-access/requests', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'x', timestamp: '', path: '/', requestId: 'r' },
          { status: 500 },
        ),
      ),
    );
    renderSection();

    expect(screen.queryByText('No requests waiting.')).toBeNull();
    expect(await screen.findByText('Could not load the waiting requests. Try again.')).toBeTruthy();
    expect(screen.queryByText('No requests waiting.')).toBeNull();
  });

  it('a failed platform-actions list still shows the live session with End', async () => {
    mockApi('allowed', { sessions: [session] });
    server.use(
      http.get('/api/v1/support-access/platform-actions', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'x', timestamp: '', path: '/', requestId: 'r' },
          { status: 500 },
        ),
      ),
    );
    renderSection();

    expect(await screen.findByRole('button', { name: /^End/ })).toBeTruthy();
  });

  it('a full page of sessions offers Next and asks the server for page 2', async () => {
    mockApi('allowed');
    const pages: (string | null)[] = [];
    server.use(
      http.get('/api/v1/support-access/sessions', ({ request }) => {
        const page = new URL(request.url).searchParams.get('page');
        pages.push(page);
        return HttpResponse.json(
          page === '2'
            ? [{ ...session, id: 's-last', status: 'ENDED' }]
            : Array.from({ length: 100 }, (_, i) => ({ ...session, id: `s${i}`, status: 'ENDED' })),
        );
      }),
    );
    const { user } = renderSection();

    await user.click(await screen.findByRole('button', { name: 'Next' }));

    await waitFor(() => expect(pages).toContain('2'));
  });
});
