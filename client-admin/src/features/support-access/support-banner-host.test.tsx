import '@biddaloy/ui/test';

import {
  apiClient,
  clearAuthState,
  isSupportSession,
  readSupportEntry,
  setSupportSession,
  writeSupportEntry,
} from '@biddaloy/ui/api';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SupportBannerHost } from './support-banner-host';

function enter(minutes = 30) {
  setSupportSession(true);
  writeSupportEntry({
    token: 't',
    sessionId: 's',
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    tenantId: 't-1',
    role: 'TEACHER',
  });
}

function mockMe(viewOnly: boolean) {
  server.use(
    http.get('/api/v1/auth/impersonation/me', () =>
      HttpResponse.json({
        sessionId: 's',
        adminName: 'Owner',
        userName: 'Rahim',
        role: 'TEACHER',
        viewOnly,
        writeLocked: false,
        expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      }),
    ),
  );
}

describe('SupportBannerHost', () => {
  afterEach(async () => {
    clearAuthState();
    sessionStorage.clear();
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('renders nothing in a normal tab', () => {
    const { container } = renderWithProviders(<SupportBannerHost />, { locale: 'en' });
    expect(container.textContent).toBe('');
  });

  it('names who the owner is signed in as, with minutes left and no view-only tag', async () => {
    mockMe(false);
    enter();
    renderWithProviders(<SupportBannerHost />, { locale: 'en', tenantId: 't-1' });
    await screen.findByText('Biddaloy support, as Rahim, Teacher');
    expect(screen.getByText('0:30')).toBeTruthy();
    expect(screen.queryByText('View only')).toBeNull();
  });

  it('shows the view-only tag', async () => {
    mockMe(true);
    enter();
    renderWithProviders(<SupportBannerHost />, { locale: 'en', tenantId: 't-1' });
    await screen.findByText('View only');
  });

  it('is print-hidden and phone-safe (wraps text, 44px End button)', async () => {
    mockMe(false);
    enter();
    renderWithProviders(<SupportBannerHost />, { locale: 'en', tenantId: 't-1' });
    const end = await screen.findByRole('button', { name: 'End' });
    expect(end.className).toContain('min-h-11');
    expect(end.parentElement?.className).toContain('print:hidden');
  });

  function stubReplace() {
    const replace = vi.fn();
    const real = window.location;
    vi.stubGlobal('location', { ...real, replace, href: real.href });
    return replace;
  }

  it('End calls the route, clears state, closes and goes to the ended page', async () => {
    mockMe(false);
    enter();
    const ended = vi.fn();
    server.use(
      http.post('/api/v1/auth/impersonation/end', () => {
        ended();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const replace = stubReplace();
    renderWithProviders(<SupportBannerHost />, { locale: 'en', tenantId: 't-1' });
    await userEvent.click(await screen.findByRole('button', { name: 'End' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/support/enter?ended=1'));
    expect(ended).toHaveBeenCalledTimes(1);
    expect(isSupportSession()).toBe(false);
    // The entry is gone; only the ended marker stays, so a reload cannot refresh as a normal tab.
    expect(sessionStorage.getItem('biddaloy:supportTab')).toBeNull();
    expect(readSupportEntry()).toBe('expired');
    expect(close).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('shows no text until the name arrives, and ends the tab if the server refuses', async () => {
    enter();
    server.use(
      http.get('/api/v1/auth/impersonation/me', () =>
        HttpResponse.json({ statusCode: 401, message: 'x' }, { status: 401 }),
      ),
    );
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const replace = stubReplace();
    const { container } = renderWithProviders(<SupportBannerHost />, {
      locale: 'en',
      tenantId: 't-1',
    });
    expect(container.textContent).toBe('');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/support/enter?ended=1'));
    vi.unstubAllGlobals();
  });

  it('a 500 from the status check keeps the session instead of ending the tab', async () => {
    enter();
    const asked = vi.fn();
    server.use(
      http.get('/api/v1/auth/impersonation/me', () => {
        asked();
        return HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 });
      }),
    );
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const replace = stubReplace();
    renderWithProviders(<SupportBannerHost />, { locale: 'en', tenantId: 't-1' });
    await waitFor(() => expect(asked).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 150));
    expect(replace).not.toHaveBeenCalled();
    expect(isSupportSession()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('End bounds the server call with a timeout so a stalled request cannot hold the tab', async () => {
    mockMe(false);
    enter();
    const post = vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('timeout of 5000ms'));
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const replace = stubReplace();
    renderWithProviders(<SupportBannerHost />, { locale: 'en', tenantId: 't-1' });
    await userEvent.click(await screen.findByRole('button', { name: 'End' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/support/enter?ended=1'));
    expect(post).toHaveBeenCalledWith('/auth/impersonation/end', undefined, { timeout: 5000 });
    vi.unstubAllGlobals();
  });
});
