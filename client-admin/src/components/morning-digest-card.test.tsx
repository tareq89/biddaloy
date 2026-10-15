import '@biddaloy/ui/test';

import { toast } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MorningDigestCard } from './morning-digest-card';

function mockMe(preferences: unknown) {
  server.use(http.get('/api/v1/users/me', () => HttpResponse.json({ id: 'u1', preferences })));
}

function render(role: string, locale: 'en' | 'bn' = 'en') {
  return renderWithProviders(<MorningDigestCard />, { locale, role, tenantId: 'tenant-1' });
}

describe('MorningDigestCard', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('is on when preferences are absent; turning it off PATCHes enabled:false', async () => {
    const toastSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');
    let me: unknown = null;
    let body: unknown;
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json({ id: 'u1', preferences: me })),
      http.patch('/api/v1/users/me/preferences/digest', async ({ request }) => {
        body = await request.json();
        me = { digest: { enabled: false } };
        return HttpResponse.json({ enabled: false });
      }),
    );
    const { user } = render('TEACHER');
    const box = await screen.findByRole('checkbox', { name: 'Send me the morning summary' });
    await waitFor(() => expect(box.getAttribute('aria-checked')).toBe('true'));
    await user.click(box);
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Saved'));
    expect(body).toEqual({ enabled: false });
    await waitFor(() => expect(box.getAttribute('aria-checked')).toBe('false'));
  });

  it('is off when stored false; clicking sends enabled:true', async () => {
    mockMe({ digest: { enabled: false } });
    let body: unknown;
    server.use(
      http.patch('/api/v1/users/me/preferences/digest', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ enabled: true });
      }),
    );
    const { user } = render('EXECUTIVE');
    const box = await screen.findByRole('checkbox');
    await waitFor(() => expect(box.getAttribute('aria-checked')).toBe('false'));
    await user.click(box);
    await waitFor(() => expect(body).toEqual({ enabled: true }));
  });

  it.each(['ACCOUNTANT', 'OFFICE_STAFF', 'EXAM_CONTROLLER', 'COMMITTEE', 'PARENT'])(
    '%s renders nothing and requests nothing',
    async (role) => {
      const seen = vi.fn();
      server.use(
        http.get('/api/v1/users/me', () => {
          seen();
          return HttpResponse.json({});
        }),
      );
      const { container } = render(role);
      await Promise.resolve();
      expect(container.innerHTML).toBe('');
      expect(seen).not.toHaveBeenCalled();
    },
  );

  it('shows an error and puts the checkbox back when the PATCH fails', async () => {
    mockMe(null);
    server.use(
      http.patch('/api/v1/users/me/preferences/digest', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    const { user } = render('TEACHER');
    const box = await screen.findByRole('checkbox');
    await waitFor(() => expect(box.getAttribute('aria-checked')).toBe('true'));
    await user.click(box);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(box.getAttribute('aria-checked')).toBe('true');
  });

  it('ADMIN sees the school digest time; TEACHER makes no settings request', async () => {
    mockMe(null);
    server.use(
      http.get('/api/v1/schools/tenant-1/settings', () =>
        HttpResponse.json({ dashboard: { digestTime: '07:15' } }),
      ),
    );
    const admin = render('ADMIN');
    expect(await screen.findByText(/7:15/)).toBeTruthy();
    admin.unmount();
    await cleanupTestState();

    mockMe(null);
    const settings = vi.fn();
    server.use(
      http.get('/api/v1/schools/tenant-1/settings', () => {
        settings();
        return HttpResponse.json({ dashboard: { digestTime: '07:15' } });
      }),
    );
    render('TEACHER');
    await screen.findByRole('checkbox');
    expect(screen.queryByText(/7:15/)).toBeNull();
    expect(settings).not.toHaveBeenCalled();
  });

  it('shows the push hint only when notification permission is not granted', async () => {
    mockMe(null);
    vi.stubGlobal('Notification', { permission: 'default' });
    const first = render('TEACHER');
    expect(
      await screen.findByText('Turn on notifications on this device to receive it.'),
    ).toBeTruthy();
    first.unmount();

    vi.stubGlobal('Notification', { permission: 'granted' });
    render('TEACHER');
    await screen.findByRole('checkbox');
    expect(screen.queryByText('Turn on notifications on this device to receive it.')).toBeNull();
  });

  it('has an accessible name and no axe violations', async () => {
    mockMe(null);
    const { container } = render('TEACHER');
    await screen.findByRole('checkbox', { name: 'Send me the morning summary' });
    await expect(container).toHaveNoViolations();
  });
});
