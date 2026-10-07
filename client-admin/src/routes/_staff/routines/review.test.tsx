import { toast } from '@biddaloy/ui/components';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatNumber, formatTime } from '@biddaloy/ui/utils';
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

const SECTION_A = '33333333-3333-4333-8333-333333333333';
const SECTION_B = '44444444-4444-4444-8444-444444444444';

const SLOT = {
  slot: {
    id: 'slot-1',
    section_id: SECTION_A,
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
          { id: 'subject-math', name_en: 'Math', name_bn: 'গণিত', code: 'MATH', is_active: true },
        ],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [{ id: 'class-1', name: 'Class 6' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes/class-1/sections', () =>
      HttpResponse.json([
        { id: SECTION_A, section_name: 'A' },
        { id: SECTION_B, section_name: 'B' },
      ]),
    ),
    http.get('/api/v1/routines/shifts', () =>
      HttpResponse.json({
        data: [{ id: 'shift-1' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/routines/shifts/shift-1/period-slots', () =>
      HttpResponse.json([
        {
          id: 'p1',
          sequence: 1,
          kind: 'CLASS',
          name: null,
          starts_at: '08:00:00',
          ends_at: '08:40:00',
        },
      ]),
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

function mockTeachers(
  data: { id: string; user: { id: string; full_name: string } }[] = [
    { id: 'teacher-1', user: { id: 'user-1', full_name: 'Mr Karim' } },
  ],
) {
  server.use(
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({ data, total: data.length, page: 1, limit: 100, totalPages: 1 }),
    ),
  );
}

function mockRoutine(state: 'DRAFT' | 'REVIEW' | 'PUBLISHED', slots: unknown[] = [SLOT]) {
  server.use(
    http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state }])),
    http.get('/api/v1/routines/routine-1/slots', () => HttpResponse.json(slots)),
    http.get('/api/v1/routines/routine-1/change-requests', () => HttpResponse.json([])),
  );
}

function renderReview(
  role: 'ADMIN' | 'TEACHER' = 'ADMIN',
  locale: 'en' | 'bn' = 'en',
  entry = '/routines/review',
) {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    ...(role === 'TEACHER' ? { accessToken: fakeJwtWithSubject('current-user') } : {}),
    locale,
  });
}

describe('/routines/review', () => {
  it('shows a DRAFT routine as a badge plus who can see it, with one primary action', async () => {
    mockLookups();
    mockRoutine('DRAFT');
    mockTeachers();
    renderReview();

    expect(await screen.findByText('Draft')).toBeTruthy();
    expect(screen.getByText('Who can see it')).toBeTruthy();
    expect(screen.getByText('Only the people who build the routine')).toBeTruthy();
    expect(screen.getByRole('button', { name: /submit for review/i })).toBeTruthy();
  });

  it('a PUBLISHED routine has no primary action and a teacher sees only their own periods', async () => {
    mockLookups();
    mockRoutine('PUBLISHED', [
      SLOT,
      { ...SLOT, slot: { ...SLOT.slot, id: 'slot-2', weekday: 2 }, teacher_ids: ['teacher-2'] },
    ]);
    mockTeachers([
      { id: 'teacher-1', user: { id: 'current-user', full_name: 'Ms Nahar' } },
      { id: 'teacher-2', user: { id: 'other-user', full_name: 'Mr Karim' } },
    ]);
    renderReview('TEACHER');

    expect(await screen.findByText('Teachers, students and guardians')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'My periods' })).toBeTruthy();
    const requestButtons = await screen.findAllByRole('button', { name: /request a change/i });
    expect(requestButtons).toHaveLength(1);
  });

  it('a period row names its class and section, a clean time range, and the Bangla subject', async () => {
    mockLookups();
    mockRoutine('PUBLISHED');
    mockTeachers();
    renderReview('ADMIN', 'bn');

    const time = `${formatTime('08:00:00', REGION_BD_BN)} – ${formatTime('08:40:00', REGION_BD_BN)}`;
    expect(await screen.findByText('Class 6 – A')).toBeTruthy();
    expect(screen.getByText('গণিত')).toBeTruthy();
    expect(screen.getByText(time)).toBeTruthy();
    expect(screen.queryByText(/08:00:00/)).toBeNull();
    expect(screen.getByText(`পিরিয়ড ${formatNumber(1, REGION_BD_BN)}`)).toBeTruthy();
  });

  it('the section filter writes ?sectionId= and narrows the rows', async () => {
    mockLookups();
    mockRoutine('PUBLISHED', [
      SLOT,
      { ...SLOT, slot: { ...SLOT.slot, id: 'slot-2', section_id: SECTION_B } },
    ]);
    mockTeachers();
    const { router } = renderReview();
    const user = userEvent.setup();

    await screen.findByText('Class 6 – A');
    expect(screen.getAllByText('Class 6 – B').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('combobox', { name: 'Class and section' }));
    await user.click(await screen.findByRole('option', { name: 'Class 6 – B' }));

    await waitFor(() => expect(router.state.location.search).toEqual({ sectionId: SECTION_B }));
    await waitFor(() => expect(screen.queryByText('Class 6 – A')).toBeNull());
  });

  it('shows an unknown subject, section and requester as a dash, never an id', async () => {
    mockLookups();
    mockRoutine('PUBLISHED', [
      { ...SLOT, slot: { ...SLOT.slot, section_id: 'section-gone', subject_id: 'subject-gone' } },
    ]);
    mockTeachers([]);
    renderReview();

    await screen.findByRole('table', { name: 'Periods of the routine' });
    expect(screen.queryByText('section-gone')).toBeNull();
    expect(screen.queryByText('subject-gone')).toBeNull();
  });

  it('shows the page title while loading, then the no-routine empty state', async () => {
    mockLookups();
    server.use(http.get('/api/v1/routines', () => HttpResponse.json([])));
    renderReview();

    expect(await screen.findByRole('heading', { name: 'No routine yet' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Routine review' })).toBeTruthy();
  });

  it('a REVIEW routine offers withdraw (outline) and publish (primary), and an empty period list shows its empty state', async () => {
    mockLookups();
    mockRoutine('REVIEW', []);
    mockTeachers([]);
    let withdrawCalled = false;
    server.use(
      http.post('/api/v1/routines/routine-1/withdraw', () => {
        withdrawCalled = true;
        return HttpResponse.json({ ...ROUTINE, state: 'DRAFT' });
      }),
    );
    renderReview();

    const withdraw = await screen.findByRole('button', { name: /withdraw/i });
    expect(withdraw.getAttribute('data-variant')).toBe('outline');
    expect(screen.getByRole('button', { name: /publish/i }).getAttribute('data-variant')).toBe(
      'default',
    );
    expect(await screen.findByRole('heading', { name: 'No periods yet' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Change requests' })).toBeNull();

    const user = userEvent.setup();
    await user.click(withdraw);
    await waitFor(() => expect(withdrawCalled).toBe(true));
  });

  it('a teacher with no matching Teacher record sees the not-a-teacher empty state', async () => {
    mockLookups();
    mockRoutine('PUBLISHED');
    mockTeachers([]);
    renderReview('TEACHER');

    expect(await screen.findByRole('heading', { name: 'No periods for you' })).toBeTruthy();
  });

  it('a teacher can open the change-request dialog only for a PUBLISHED routine', async () => {
    mockLookups();
    mockRoutine('PUBLISHED');
    mockTeachers([{ id: 'teacher-1', user: { id: 'current-user', full_name: 'Ms Nahar' } }]);
    renderReview('TEACHER');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /request a change/i }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('What needs to change')).toBeTruthy();
  });

  it('a teacher gets no request-change action, and an explanation, on a non-PUBLISHED routine', async () => {
    mockLookups();
    mockRoutine('DRAFT');
    mockTeachers([{ id: 'teacher-1', user: { id: 'current-user', full_name: 'Ms Nahar' } }]);
    renderReview('TEACHER');

    expect(
      await screen.findByText('Change requests can only be raised once the routine is published.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /request a change/i })).toBeNull();
  });

  it('an admin can open the copy dialog (no native select, current year excluded), cancel, reopen and confirm', async () => {
    mockLookups();
    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');
    try {
      mockRoutine('PUBLISHED');
      mockTeachers([]);
      server.use(
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
      renderReview();

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Copy to another year' }));
      await screen.findByRole('dialog');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      await user.click(screen.getByRole('button', { name: 'Copy to another year' }));
      await screen.findByRole('dialog');
      expect(document.querySelector('select')).toBeNull();
      await user.click(screen.getByRole('combobox', { name: 'Copy to' }));
      expect(screen.queryByRole('option', { name: '2026' })).toBeNull();
      await user.click(await screen.findByRole('option', { name: '2027' }));
      await user.click(screen.getByRole('button', { name: 'Copy' }));

      await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Copied — 2 periods left out'));
    } finally {
      successSpy.mockRestore();
    }
  });

  it('shows the loading skeleton, not the not-a-teacher state, while the own-teacher lookup is pending', async () => {
    mockLookups();
    mockRoutine('PUBLISHED');
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/v1/teachers', async () => {
        await gate;
        return HttpResponse.json({
          data: [{ id: 'teacher-1', user: { id: 'current-user', full_name: 'Ms Nahar' } }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        });
      }),
    );
    const { container } = renderReview('TEACHER');

    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(screen.queryByRole('heading', { name: 'No periods for you' })).toBeNull();
    release();
    expect(await screen.findByRole('heading', { name: 'My periods' })).toBeTruthy();
  });
});
