import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

const VERIFICATION = {
  document_kind: 'STUDENT_ID_CARD',
  holder_name: 'Rahim Ahmed',
  school_name: 'Ananta High School',
  school_name_bn: 'অনন্ত উচ্চ বিদ্যালয়',
  issued_at: '2027-03-01T00:00:00.000Z',
  copy_number: 2,
  status: 'VALID',
};

const errorBody = (status: number) =>
  new HttpResponse(
    JSON.stringify({
      statusCode: status,
      message: 'nope',
      timestamp: new Date().toISOString(),
      path: '/api/v1/public/verify/x',
      requestId: 'req-1',
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

/** [32.3.9] — a public route reachable with no session. Like `/i/$token`, no
 * test registers an `/auth/refresh` handler: if this page ever called
 * `apiClient` or `ensureSessionLoaded`, msw's `onUnhandledRequest: 'error'`
 * would fail the test, so "no auth call" stays enforced. */
describe('/v/$token verify page', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows a valid document with its rows, and sends no tenant header', async () => {
    let tenantHeader: string | null = 'unset';
    server.use(
      http.get('/api/v1/public/verify/:token', ({ request }) => {
        tenantHeader = request.headers.get('x-tenant-id');
        return HttpResponse.json(VERIFICATION);
      }),
    );

    renderWithRouter(routeTree, { initialEntries: ['/v/live-token'], locale: 'en' });

    await waitFor(() => expect(screen.getByText('Valid document')).toBeTruthy());
    expect(screen.getByText('Student ID card')).toBeTruthy();
    expect(screen.getByText('Rahim Ahmed')).toBeTruthy();
    expect(screen.getByText('Ananta High School')).toBeTruthy(); // English name in English
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('Verified by SchoolManager')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Verify document' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to SchoolManager home' })).toBeTruthy();
    expect(tenantHeader).toBeNull();
  });

  it('shows a revoked document in words, with the revoke date', async () => {
    server.use(
      http.get('/api/v1/public/verify/:token', () =>
        HttpResponse.json({
          ...VERIFICATION,
          status: 'REVOKED',
          revoked_at: '2027-04-01T00:00:00.000Z',
        }),
      ),
    );

    renderWithRouter(routeTree, { initialEntries: ['/v/revoked-token'], locale: 'en' });

    await waitFor(() => expect(screen.getByText('This document has been revoked')).toBeTruthy());
    expect(screen.getByText(/Revoked on/)).toBeTruthy();
    expect(screen.queryByText('Valid document')).toBeNull();
  });

  it('says it could not find an unknown token, without retrying', async () => {
    let calls = 0;
    server.use(
      http.get('/api/v1/public/verify/:token', () => {
        calls += 1;
        return errorBody(404);
      }),
    );

    renderWithRouter(routeTree, { initialEntries: ['/v/unknown-token'], locale: 'en' });

    await waitFor(() => expect(screen.getByText('We could not find this document')).toBeTruthy());
    expect(screen.getByText('Check that you scanned the whole code.')).toBeTruthy();
    expect(calls).toBe(1);
  });

  it('tells the visitor to wait when throttled (429)', async () => {
    server.use(http.get('/api/v1/public/verify/:token', () => errorBody(429)));

    renderWithRouter(routeTree, { initialEntries: ['/v/busy-token'], locale: 'en' });

    await waitFor(() =>
      expect(screen.getByText('Too many checks — try again in a minute.')).toBeTruthy(),
    );
  });

  it('shows the Bangla school name first in Bangla', async () => {
    server.use(http.get('/api/v1/public/verify/:token', () => HttpResponse.json(VERIFICATION)));

    renderWithRouter(routeTree, { initialEntries: ['/v/live-token'], locale: 'bn' });

    await waitFor(() => expect(screen.getByText('অনন্ত উচ্চ বিদ্যালয়')).toBeTruthy());
    expect(screen.queryByText('Ananta High School')).toBeNull();
    expect(screen.getByText('নথিটি সঠিক ও বৈধ')).toBeTruthy();
  });
});
