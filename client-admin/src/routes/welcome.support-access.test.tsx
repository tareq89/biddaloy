import { cleanupTestState, renderWithProviders, renderWithRouter, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../routeTree.gen';

import { SupportWelcomeForm } from './welcome.support-access';

function fakeJwt(): string {
  const payload = btoa(
    JSON.stringify({ memberships: [{ tenantId: 'tenant-1', role: 'ADMIN', name: 'Greenview' }] }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `h.${payload}.s`;
}

const settings = {
  mode: 'allowed',
  confirmedAt: null,
  confirmedByName: null,
  textVersion: 0,
  currentTextVersion: 1,
  needsConfirmation: true,
};

function mockSettings() {
  server.use(http.get('/api/v1/support-access/settings', () => HttpResponse.json(settings)));
}

function render() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/welcome/support-access?redirect=%2Fstudents'],
    accessToken: fakeJwt(),
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

afterEach(async () => {
  await cleanupTestState();
});

describe('/welcome/support-access', () => {
  it('is ticked by default and saves allowed, then goes to the kept target', async () => {
    mockSettings();
    let body: unknown;
    server.use(
      http.post('/api/v1/support-access/confirm', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...settings, confirmedAt: 'x', needsConfirmation: false });
      }),
    );
    const user = userEvent.setup();
    const { router, container } = render();

    const box = await screen.findByRole('checkbox', { name: 'Allow Biddaloy support access' });
    expect(box.getAttribute('aria-checked')).toBe('true');
    await expect(container).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
    expect(body).toEqual({ allowed: true, textVersion: 1 });
  });

  it('unticked saves blocked; Space toggles and Enter confirms', async () => {
    mockSettings();
    let body: unknown;
    server.use(
      http.post('/api/v1/support-access/confirm', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(settings);
      }),
    );
    const user = userEvent.setup();
    render();

    const box = await screen.findByRole('checkbox', { name: 'Allow Biddaloy support access' });
    box.focus();
    await user.keyboard(' ');
    expect(box.getAttribute('aria-checked')).toBe('false');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(body).toEqual({ allowed: false, textVersion: 1 }));
  });

  it('shows an error and stays when saving fails', async () => {
    mockSettings();
    server.use(
      http.post('/api/v1/support-access/confirm', () =>
        HttpResponse.json({ statusCode: 500, message: 'x', requestId: 'r' }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    const { router } = render();

    await user.click(await screen.findByRole('button', { name: 'Save and continue' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Try again.');
    expect(router.state.location.pathname).toBe('/welcome/support-access');
  });

  it('while saving, the checkbox is off and Enter does not send a second request', async () => {
    const onSave = vi.fn();
    const { container } = renderWithProviders(<SupportWelcomeForm onSave={onSave} saving />, {
      locale: 'en',
    });
    const box = await screen.findByRole('checkbox', { name: 'Allow Biddaloy support access' });
    expect((box as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(onSave).not.toHaveBeenCalled();
  });
});
