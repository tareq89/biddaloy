import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

vi.useFakeTimers({ toFake: ['Date'] });
afterAll(() => {
  vi.useRealTimers();
});
vi.setSystemTime(new Date('2026-09-23T09:00:00.000Z'));

afterEach(async () => {
  await cleanupTestState();
});

/** Same fake-JWT shape `review.test.tsx` uses. */
function fakeJwtWithSubject(sub: string): string {
  const payload = btoa(JSON.stringify({ sub }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const ROUTINE = { id: 'routine-1', academic_year_id: 'year-1', created_at: '2026-01-01T00:00:00Z' };

function mockCommonLookups() {
  server.use(
    http.get('/api/v1/subjects', () =>
      HttpResponse.json({
        data: [
          { id: 'subject-en', name_en: 'English', name_bn: null, code: 'ENG', is_active: true },
        ],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/routines/rooms', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
    http.get('/api/v1/routines/shifts', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
    http.get('/api/v1/calendar-settings', () =>
      HttpResponse.json({
        termLabel: 'TERM',
        country: 'BD',
        firstDayOfWeek: 0,
        weeklyOffDays: [5],
        timezone: 'Asia/Dhaka',
      }),
    ),
    http.get('/api/v1/calendar/events', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
    // ROUTINE.academic_year_id is 'year-1' — my.tsx only shows a routine
    // whose year is the one the server marks current, so the default
    // factory's random-uuid "current" year would hide it.
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [{ id: 'year-1', name: '2026', is_current: true }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

describe('/routines/my', () => {
  it('shows the page title and a no-teacher empty state with a link for a routine manager', async () => {
    mockCommonLookups();
    server.use(
      http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'PUBLISHED' }])),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/my'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      accessToken: fakeJwtWithSubject('admin-user'),
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'My routine' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'No routine for you' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'See class routines' })).toBeTruthy();
  });

  it('says the school has not published a routine yet when none exists beyond DRAFT', async () => {
    mockCommonLookups();
    server.use(
      http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'DRAFT' }])),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({
          data: [{ id: 'teacher-1', user: { id: 'current-user', full_name: 'Ms Nahar' } }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/my'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      accessToken: fakeJwtWithSubject('current-user'),
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { name: 'No routine published yet' })).toBeTruthy();
    expect(screen.getByText(/hasn't published a routine yet/i)).toBeTruthy();
  });
});
