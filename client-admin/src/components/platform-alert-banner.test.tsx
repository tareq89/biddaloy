import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, renderWithRouter, server } from '@biddaloy/ui/test';
import { focusManager } from '@tanstack/react-query';
import { createRootRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlatformAlertBanner } from './platform-alert-banner';
import { ReadOnlyNotice } from './read-only-notice';

const OPEN = { alerts: [{ kind: 'REDIS_DOWN', opened_at: '2026-10-13T08:02:00.000Z' }] };

describe('PlatformAlertBanner', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the red notice when an alert is open', async () => {
    server.use(http.get('/api/v1/platform/alerts', () => HttpResponse.json(OPEN)));
    renderWithProviders(<PlatformAlertBanner enabled />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    const notice = await screen.findByRole('status');
    expect(notice.textContent).toMatch(/^Redis is down since .*\. Sign-in and password reset/);
    // Not dismissable: no button of any kind inside the banner.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when no alert is open', async () => {
    const hit = vi.fn(() => HttpResponse.json({ alerts: [] }));
    server.use(http.get('/api/v1/platform/alerts', hit));
    const { container } = renderWithProviders(<PlatformAlertBanner enabled />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(hit).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('sends no request and renders nothing when disabled (non-SUPER_ADMIN)', async () => {
    const hit = vi.fn(() => HttpResponse.json(OPEN));
    server.use(http.get('/api/v1/platform/alerts', hit));
    const { container } = renderWithProviders(<PlatformAlertBanner enabled={false} />, {
      locale: 'en',
      role: 'ADMIN',
    });

    await Promise.resolve();
    expect(hit).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });

  it('keeps the banner when a later poll fails', async () => {
    let fail = false;
    server.use(
      http.get('/api/v1/platform/alerts', () =>
        fail ? HttpResponse.json({ message: 'x' }, { status: 400 }) : HttpResponse.json(OPEN),
      ),
    );
    const { queryClient } = renderWithProviders(<PlatformAlertBanner enabled />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });
    await screen.findByRole('status');

    fail = true;
    await queryClient.refetchQueries({ queryKey: ['platform-alerts'] });
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('stops polling after a 403 (school-local SUPER_ADMIN)', async () => {
    const hit = vi.fn(() =>
      HttpResponse.json(
        {
          statusCode: 403,
          message: 'Forbidden',
          timestamp: new Date().toISOString(),
          path: '/api/v1/platform/alerts',
          requestId: 'r1',
        },
        { status: 403 },
      ),
    );
    server.use(http.get('/api/v1/platform/alerts', hit));
    const { container, queryClient } = renderWithProviders(<PlatformAlertBanner enabled />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    await waitFor(() =>
      expect(queryClient.getQueryState(['platform-alerts'])?.status).toBe('error'),
    );
    const query = queryClient.getQueryCache().find({ queryKey: ['platform-alerts'] })!;
    const interval = query.observers[0]!.options.refetchInterval;
    expect(typeof interval === 'function' ? interval(query) : interval).toBe(false);
    // Nor on tab focus or on mount. Read from the options because the test QueryClient turns
    // focus refetches off by default, so a focus event here could not show the difference.
    const { refetchOnMount, refetchOnWindowFocus } = query.observers[0]!.options;
    expect(typeof refetchOnMount === 'function' ? refetchOnMount(query) : refetchOnMount).toBe(
      false,
    );
    expect(
      typeof refetchOnWindowFocus === 'function'
        ? refetchOnWindowFocus(query)
        : refetchOnWindowFocus,
    ).toBe(false);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe('');
  });

  it('still refetches on tab focus after an error that is not a 403', async () => {
    const hit = vi.fn(() => HttpResponse.json({ message: 'x' }, { status: 400 }));
    server.use(http.get('/api/v1/platform/alerts', hit));
    const { queryClient } = renderWithProviders(<PlatformAlertBanner enabled />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });
    await waitFor(() =>
      expect(queryClient.getQueryState(['platform-alerts'])?.status).toBe('error'),
    );
    const before = hit.mock.calls.length;

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(hit).toHaveBeenCalledTimes(before + 1));
    focusManager.setFocused(undefined);
  });

  it('renders the bn text', async () => {
    server.use(http.get('/api/v1/platform/alerts', () => HttpResponse.json(OPEN)));
    renderWithProviders(<PlatformAlertBanner enabled />, {
      locale: 'bn',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    const notice = await screen.findByRole('status');
    expect(notice.textContent).toContain('থেকে Redis বন্ধ');
  });
});

describe('ReadOnlyNotice', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('says when the school pauses and links to buy seats', async () => {
    renderWithRouter(
      createRootRoute({ component: () => <ReadOnlyNotice until="2026-12-07T18:00:00.000Z" /> }),
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toMatch(
      /^Read-only\. The school pauses on .+\. Buy seats to keep it open\./,
    );
    expect(screen.getByRole('link', { name: 'Buy seats' })).toBeTruthy();
  });
});
