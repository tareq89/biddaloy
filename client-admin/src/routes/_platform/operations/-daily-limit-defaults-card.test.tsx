import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { DailyLimitDefaultsCard } from './-daily-limit-defaults-card';

const URL = '*/platform/settings/daily-limits';
const view = (stored: object = {}) => ({
  stored,
  effective: { sms: 2000, email: 2000, whatsapp: 2000, showRemaining: false, ...stored },
  usedToday: null,
});
const render = () =>
  renderWithProviders(<DailyLimitDefaultsCard />, {
    locale: 'en',
    role: 'SUPER_ADMIN',
    tenantId: 'super-admin-own-tenant',
  });

afterEach(async () => {
  await cleanupTestState();
});

describe('DailyLimitDefaultsCard', () => {
  it('shows the built-in hint and no used-today line', async () => {
    server.use(http.get(URL, () => HttpResponse.json(view())));
    render();
    expect((await screen.findAllByText('Built-in value: ২,০০০')).length).toBe(3);
    expect(screen.queryByText(/Sent today/)).toBeNull();
  });

  it('saves the platform default and sends null for empty boxes', async () => {
    let body: unknown;
    server.use(
      http.get(URL, () => HttpResponse.json(view())),
      http.put(URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(view({ email: 100 }));
      }),
    );
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByLabelText('Email · Daily limit'), '100');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(body).toEqual({ sms: null, email: 100, whatsapp: null, showRemaining: null }),
    );
  });

  it('shows a 400 inline', async () => {
    server.use(
      http.get(URL, () => HttpResponse.json(view())),
      http.put(URL, () => HttpResponse.json({ message: 'bad' }, { status: 400 })),
    );
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't save");
  });
});
