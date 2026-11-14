import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SmsSourceCard } from './SmsSourceCard';

afterEach(async () => {
  await cleanupTestState();
});

const render = (ui: React.ReactElement) =>
  renderWithProviders(ui, { locale: 'en', role: 'ADMIN', tenantId: 'school-1' });

describe('SmsSourceCard', () => {
  it('explains the switch and keeps the saved provider', async () => {
    render(<SmsSourceCard />);
    expect(await screen.findByText(/stay saved/)).toBeTruthy();
  });

  it('switches to SchoolManagerP only (never touches own-provider settings)', async () => {
    let body: unknown;
    server.use(
      http.put('/api/v1/communications/sms-source', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ source: 'SCHOOLMANAGERP', ownProviderSaved: true });
      }),
    );
    const onSwitched = vi.fn();
    render(<SmsSourceCard onSwitched={onSwitched} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Switch to SchoolManagerP SMS' }),
    );
    await waitFor(() => expect(onSwitched).toHaveBeenCalled());
    expect(body).toEqual({ source: 'SCHOOLMANAGERP' });
  });

  it('says so when the switch fails', async () => {
    server.use(
      http.put('/api/v1/communications/sms-source', () =>
        HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 }),
      ),
    );
    render(<SmsSourceCard />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Switch to SchoolManagerP SMS' }),
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
