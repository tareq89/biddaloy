/** [67.5.08] Notification preferences card: locked urgent row, switches, merge-on-save, quiet hours, error. */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { NotificationPrefsCard } from './notification-prefs-card';

const BN = '০১২৩৪৫৬৭৮৯';
const digits = (text: string) => new RegExp(text.replace(/\d/g, (d) => `[${d}${BN[Number(d)]}]`));

function prefs(mutedCategories: string[]) {
  return http.get('*/users/me/preferences/notifications', () =>
    HttpResponse.json({ mutedCategories, quietHours: { start: '21:00', end: '07:00' } }),
  );
}

function renderCard() {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <NotificationPrefsCard role={'TEACHER' as never} />,
  });
  renderWithRouter(root.addChildren([index]), {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'TEACHER',
    locale: 'en',
  });
}

describe('NotificationPrefsCard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows a locked urgent row, switches that reflect the muted list, and the quiet hours', async () => {
    server.use(prefs(['HOMEWORK']));
    renderCard();

    const urgent = await screen.findByRole('switch', { name: 'Urgent' });
    expect(urgent.getAttribute('aria-checked')).toBe('true');
    expect(urgent).toHaveProperty('disabled', true);

    expect(screen.getByRole('switch', { name: 'Homework' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(screen.getByRole('switch', { name: 'Attendance' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByText(digits('Quiet hours: 21:00 – 07:00'))).toBeTruthy();
  });

  it("keeps Save disabled until something changes, then sends muted + the other role's mutes", async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    server.use(
      // PLATFORM is not listed for a teacher: it must survive the save.
      prefs(['PLATFORM']),
      http.patch('*/users/me/preferences/notifications', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          mutedCategories: ['PLATFORM', 'HOMEWORK'],
          quietHours: { start: '21:00', end: '07:00' },
        });
      }),
    );
    renderCard();

    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('switch', { name: 'Homework' }));
    expect(save).toHaveProperty('disabled', false);
    await user.click(save);

    await waitFor(() => expect(body).not.toBeNull());
    expect((body as { mutedCategories: string[] }).mutedCategories.sort()).toEqual([
      'HOMEWORK',
      'PLATFORM',
    ]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true),
    );
  });

  it('shows an error state whose Retry refetches', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get('*/users/me/preferences/notifications', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(
              {
                statusCode: 400,
                message: 'bad',
                timestamp: '2026-10-10T00:00:00.000Z',
                path: '/api/v1/users/me/preferences/notifications',
                requestId: 'r-1',
              },
              { status: 400 },
            )
          : HttpResponse.json({
              mutedCategories: [],
              quietHours: { start: '21:00', end: '07:00' },
            });
      }),
    );
    renderCard();
    await user.click(await screen.findByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByRole('switch', { name: 'Urgent' })).toBeTruthy();
    expect(calls).toBe(2);
  });
});
