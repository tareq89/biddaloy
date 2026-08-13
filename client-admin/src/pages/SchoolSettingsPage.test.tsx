import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchoolSettingsPage } from './SchoolSettingsPage';

// Matches ApiErrorBody's shape — apiClient's response interceptor
// (client.ts's toApiError) only recognizes this shape as an ApiError;
// anything else falls through to a plain Error, which shouldRetryQuery
// then retries twice regardless of status code before settling isError.
function apiErrorBody(statusCode: number) {
  return {
    statusCode,
    message: 'Something went wrong.',
    timestamp: new Date().toISOString(),
    path: '/api/v1/schools',
    requestId: 'test-request-id',
  };
}

describe('SchoolSettingsPage', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows a school picker for a SUPER_ADMIN, with no school selected by default', async () => {
    renderWithProviders(<SchoolSettingsPage />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    expect(await screen.findByLabelText('School')).toBeTruthy();
    // No school picked yet — the "which school" banner (the issue's own
    // "unmistakable on screen at all times" criterion) has nothing to
    // show until one is, so it stays absent rather than showing a
    // misleadingly empty/blank state.
    expect(screen.queryByRole('status', { name: /Configuring settings for/ })).toBeNull();
  });

  it('picking a school shows the "configuring" banner and every section', async () => {
    const { user } = renderWithProviders(<SchoolSettingsPage />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    const picker = await screen.findByLabelText('School');
    await waitFor(() => expect(screen.getByText('Ananta School')).toBeTruthy());
    await user.selectOptions(picker, 'Ananta School');

    await waitFor(() => {
      expect(screen.getByText(/Configuring settings for/)).toBeTruthy();
    });
    expect(await screen.findByText('WhatsApp')).toBeTruthy();
    expect(screen.getByText('Messenger')).toBeTruthy();
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByText('SMS')).toBeTruthy();
  });

  it('does not request settings before a school is selected', async () => {
    const getSettings = vi.fn();
    server.use(
      http.get('/api/v1/schools/:id/settings', ({ params }) => {
        getSettings(params.id);
        return HttpResponse.json({ version: 1, region: {} });
      }),
    );

    renderWithProviders(<SchoolSettingsPage />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    await screen.findByLabelText('School');
    // No school picked yet — useSchoolSettings('') must stay disabled
    // rather than firing a request against `/schools//settings`.
    expect(getSettings).not.toHaveBeenCalled();
  });

  it('shows an error message if the school list fails to load', async () => {
    // A 4xx, not a 5xx — shouldRetryQuery doesn't retry 4xx responses, so
    // this settles isError immediately instead of after two backoff delays.
    server.use(
      http.get('/api/v1/schools', () => HttpResponse.json(apiErrorBody(400), { status: 400 })),
    );

    renderWithProviders(<SchoolSettingsPage />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /couldn't load the list of schools/i,
    );
  });

  it("shows an error message if the selected school's settings fail to load", async () => {
    server.use(
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json(apiErrorBody(400), { status: 400 }),
      ),
    );
    const { user } = renderWithProviders(<SchoolSettingsPage />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    const picker = await screen.findByLabelText('School');
    await waitFor(() => expect(screen.getByText('Ananta School')).toBeTruthy());
    await user.selectOptions(picker, 'Ananta School');

    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn't load settings/i);
  });

  it('an ADMIN sees no picker at all — their own school loads directly', async () => {
    renderWithProviders(<SchoolSettingsPage />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });

    expect(screen.queryByLabelText('School')).toBeNull();
    await waitFor(() => {
      expect(screen.getByText(/Configuring settings for/)).toBeTruthy();
    });
  });

  it('has no accessibility violations with every section rendered', async () => {
    const { container } = renderWithProviders(<SchoolSettingsPage />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });

    await waitFor(() => {
      expect(screen.getByText('SMS')).toBeTruthy();
    });
    await expect(container).toHaveNoViolations();
  });
});
