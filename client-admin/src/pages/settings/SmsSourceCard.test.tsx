import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SmsSourceCard, SmsSwitchBackCard } from './SmsSourceCard';

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

const ownSaved = (saved: boolean) =>
  http.get('/api/v1/communications/sms-source', () =>
    HttpResponse.json({ source: 'SCHOOLMANAGERP', ownProviderSaved: saved }),
  );

describe('SmsSwitchBackCard [4145]', () => {
  it('disables the switch until the own company details are saved', async () => {
    server.use(ownSaved(false));
    render(<SmsSwitchBackCard />);
    expect(await screen.findByText(/Save your own SMS company details first/)).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Switch to our own SMS company' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks first, then switches back to the own SMS company only', async () => {
    let body: unknown;
    server.use(
      http.put('/api/v1/communications/sms-source', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ source: 'OWN', ownProviderSaved: true });
      }),
    );
    server.use(ownSaved(true));
    render(<SmsSwitchBackCard />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Switch to our own SMS company' }),
    );
    expect(body).toBeUndefined(); // nothing is sent before the confirm
    await userEvent.click(await screen.findByRole('button', { name: 'Switch' }));
    await waitFor(() => expect(body).toEqual({ source: 'OWN' }));
  });

  it('says so when switching back fails', async () => {
    server.use(
      http.put('/api/v1/communications/sms-source', () =>
        HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 }),
      ),
    );
    server.use(ownSaved(true));
    render(<SmsSwitchBackCard />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Switch to our own SMS company' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Switch' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
