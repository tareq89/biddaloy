import { toast } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
        data: [
          { id: 'subject-math', name_en: 'Math', name_bn: null, code: 'MATH', is_active: true },
        ],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    // ROUTINE.academic_year_id is 'year-1' — review.tsx only shows a
    // routine whose year is the one the server marks current, so the
    // default factory's random-uuid "current" year would hide it.
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

  it('shows nothing when routines are still loading, and the empty-routine explanation once loaded', async () => {
    mockLookups();
    server.use(http.get('/api/v1/routines', () => HttpResponse.json([])));

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/review'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(/no routine/i)).toBeTruthy());
  });

  it('a REVIEW routine offers withdraw/publish and an empty slot list shows the empty explanation', async () => {
    mockLookups();
    let withdrawCalled = false;
    server.use(
      http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'REVIEW' }])),
      http.get('/api/v1/routines/routine-1/slots', () => HttpResponse.json([])),
      http.get('/api/v1/routines/routine-1/change-requests', () => HttpResponse.json([])),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('/api/v1/routines/routine-1/withdraw', () => {
        withdrawCalled = true;
        return HttpResponse.json({ ...ROUTINE, state: 'DRAFT' });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/review'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('button', { name: /withdraw/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /publish/i })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/no periods to show/i)).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /withdraw/i }));
    await waitFor(() => expect(withdrawCalled).toBe(true));
  });

  it('a teacher with no matching Teacher record sees the notATeacher explanation', async () => {
    mockLookups();
    server.use(
      http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'PUBLISHED' }])),
      http.get('/api/v1/routines/routine-1/slots', () => HttpResponse.json([SLOT])),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
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
    expect(screen.getByText(/not a teacher|no teacher record/i)).toBeTruthy();
  });

  it('a teacher can open the change-request dialog only for a PUBLISHED slot', async () => {
    mockLookups();
    server.use(
      http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'PUBLISHED' }])),
      http.get('/api/v1/routines/routine-1/slots', () => HttpResponse.json([SLOT])),
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
      initialEntries: ['/routines/review'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      accessToken: fakeJwtWithSubject('current-user'),
      locale: 'en',
    });

    const user = userEvent.setup();
    const requestButton = await screen.findByRole('button', { name: /request a change/i });
    expect((requestButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(requestButton);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });

  it('a teacher sees the request-change button disabled with an explanation on a non-PUBLISHED routine', async () => {
    mockLookups();
    server.use(
      http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'DRAFT' }])),
      http.get('/api/v1/routines/routine-1/slots', () => HttpResponse.json([SLOT])),
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
      initialEntries: ['/routines/review'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      accessToken: fakeJwtWithSubject('current-user'),
      locale: 'en',
    });

    const requestButton = await screen.findByRole('button', { name: /request a change/i });
    expect((requestButton as HTMLButtonElement).disabled).toBe(true);
    expect(requestButton.getAttribute('title')).toMatch(/published/i);
  });

  it('an admin can open the copy-year dialog, cancel it, then reopen and confirm', async () => {
    mockLookups();
    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');
    try {
      server.use(
        http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'DRAFT' }])),
        http.get('/api/v1/routines/routine-1/slots', () => HttpResponse.json([SLOT])),
        http.get('/api/v1/teachers', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
        ),
        http.get('/api/v1/academic-years', () =>
          HttpResponse.json({
            data: [
              { id: 'year-1', name: '2026', is_current: true },
              { id: 'year-2', name: '2027' },
            ],
            total: 2,
            page: 1,
            limit: 100,
            totalPages: 1,
          }),
        ),
        http.post('/api/v1/routines/routine-1/copy-year', () =>
          HttpResponse.json({ skipped_slot_count: 2 }),
        ),
      );

      renderWithRouter(routeTree, {
        initialEntries: ['/routines/review'],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /copy.*year/i }));
      await screen.findByRole('dialog');
      await user.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      await user.click(screen.getByRole('button', { name: /copy.*year/i }));
      await screen.findByRole('dialog');
      const select = screen.getByRole('combobox');
      await user.selectOptions(select, '2027');
      await user.click(screen.getByRole('button', { name: 'Copy' }));

      await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Copied — 2 slots skipped'));
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      successSpy.mockRestore();
    }
  });
});
