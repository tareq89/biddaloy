import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

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
        data: [{ id: 'subject-en', name_en: 'English', name_bn: null, code: 'ENG', is_active: true }],
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
  );
}

describe('/routines/my', () => {
  it('says no teacher record exists for a non-teacher role', async () => {
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

    await waitFor(() => expect(screen.getByText(/no teacher record found/i)).toBeTruthy());
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

    await waitFor(() => expect(screen.getByText(/hasn't published a routine yet/i)).toBeTruthy());
  });

  it('shows own periods and marks a covered one as covering, without hiding a cancelled one', async () => {
    mockCommonLookups();
    server.use(
      http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'PUBLISHED' }])),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({
          data: [
            { id: 'teacher-1', user: { id: 'current-user', full_name: 'Ms Nahar' } },
            { id: 'teacher-2', user: { id: 'other-user', full_name: 'Mr Karim' } },
          ],
          total: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/routines/resolve', ({ request }) => {
        const url = new URL(request.url);
        const from = url.searchParams.get('from') ?? '2026-09-23';
        return HttpResponse.json([
          {
            date: from,
            routine_slot_id: 'slot-own',
            section_id: 'section-1',
            period_slot_id: 'period-1',
            weekday: 3,
            subject_id: 'subject-en',
            room_id: null,
            kind: 'CLASS',
            teacher_ids: ['teacher-1'],
            substituted: false,
            cancelled: false,
          },
          {
            date: from,
            routine_slot_id: 'slot-covering',
            section_id: 'section-1',
            period_slot_id: 'period-1',
            weekday: 3,
            subject_id: 'subject-en',
            room_id: null,
            kind: 'CLASS',
            teacher_ids: ['teacher-1'],
            substituted: true,
            substitute_teacher_id: 'teacher-1',
            covering_for_teacher_ids: ['teacher-2'],
            cancelled: false,
          },
          {
            date: from,
            routine_slot_id: 'slot-cancelled',
            section_id: 'section-1',
            period_slot_id: 'period-1',
            weekday: 3,
            subject_id: 'subject-en',
            room_id: null,
            kind: 'CLASS',
            teacher_ids: ['teacher-1'],
            substituted: false,
            cancelled: true,
          },
        ]);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/my'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      accessToken: fakeJwtWithSubject('current-user'),
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(/covering for mr karim/i)).toBeTruthy());
    expect(screen.getByText('Cancelled')).toBeTruthy();
  });
});
