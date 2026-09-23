import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

afterEach(async () => {
  await cleanupTestState();
});

/** `decodeAccessTokenSubject` never checks a signature — same fake-JWT
 * shape `select-school.test.tsx` and `session.test.ts` use. */
function fakeJwtWithSubject(sub: string): string {
  const payload = btoa(JSON.stringify({ sub }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const ROUTINE = {
  id: 'routine-1',
  academic_year_id: 'year-1',
  created_at: '2026-01-01T00:00:00Z',
};

const SLOT = {
  slot: {
    id: 'slot-1',
    section_id: 'section-1',
    weekday: 1,
    period_slot_id: 'p1',
    subject_id: 'subject-math',
    recurrence: 'WEEKLY' as const,
    recurrence_offset: 0,
    valid_from: '2026-01-01',
    valid_to: null,
  },
  teacher_ids: ['teacher-1'],
  warnings: [],
};

function mockLookups() {
  server.use(
    http.get('/api/v1/subjects', () =>
      HttpResponse.json({
        data: [{ id: 'subject-math', name_en: 'Math', name_bn: null, code: 'MATH', is_active: true }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

describe('/routines/review', () => {
  it('states, in words, who can see a DRAFT routine', async () => {
    mockLookups();
    server.use(
      http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'DRAFT' }])),
      http.get('/api/v1/routines/routine-1/slots', () => HttpResponse.json([SLOT])),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({
          data: [{ id: 'teacher-1', user: { id: 'user-1', full_name: 'Mr Karim' } }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/review'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByText(/only you \(the routine's builder\) can see this/i)).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: /submit for review/i })).toBeTruthy();
  });

  it('states, in words, who can see a PUBLISHED routine, and a teacher sees only their own slots', async () => {
    mockLookups();
    server.use(
      http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'PUBLISHED' }])),
      http.get('/api/v1/routines/routine-1/slots', () =>
        HttpResponse.json([
          SLOT,
          { ...SLOT, slot: { ...SLOT.slot, id: 'slot-2', weekday: 2 }, teacher_ids: ['teacher-2'] },
        ]),
      ),
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
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/review'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      accessToken: fakeJwtWithSubject('current-user'),
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(/visible to families/i)).toBeTruthy());
    // Only the slot assigned to the signed-in teacher's own Teacher record shows.
    const requestButtons = await screen.findAllByRole('button', { name: /request a change/i });
    expect(requestButtons).toHaveLength(1);
  });
});
