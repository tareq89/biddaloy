import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatDate } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

afterEach(async () => {
  await cleanupTestState();
});

// `substitute_teacher_id`/`covered_for_teacher_id`/`class_id`/`section_id`
// are all `z.string().uuid()` in the route's search schema (`.catch(undefined)`
// silently drops anything that fails validation) — real UUID-shaped ids
// here, not `"teacher-1"`, or a filter select never reaches the query.
const TEACHER_1_ID = '11111111-1111-4111-8111-111111111111';
const TEACHER_2_ID = '22222222-2222-4222-8222-222222222222';
const CLASS_ID = '55555555-5555-4555-8555-555555555555';
const SECTION_ID = '66666666-6666-4666-8666-666666666666';

function mockBaseData() {
  server.use(
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({
        data: [
          { id: TEACHER_1_ID, user: { id: 'user-1', full_name: 'Ms Nahar' } },
          { id: TEACHER_2_ID, user: { id: 'user-2', full_name: 'Mr Karim' } },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [{ id: CLASS_ID, name: 'Class 6' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get(`/api/v1/classes/${CLASS_ID}/sections`, () =>
      HttpResponse.json([{ id: SECTION_ID, section_name: 'B' }]),
    ),
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [{ id: 'year-1', name: '2026', is_current: true }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/routines', () =>
      HttpResponse.json([
        {
          id: 'routine-1',
          academic_year_id: 'year-1',
          state: 'PUBLISHED',
          created_at: '2026-01-01',
        },
      ]),
    ),
    http.get('/api/v1/routines/routine-1/slots', () =>
      HttpResponse.json([
        {
          slot: {
            id: 'slot-1',
            section_id: SECTION_ID,
            weekday: 4,
            period_slot_id: 'p2',
            subject_id: 'subject-math',
            recurrence: 'WEEKLY',
            recurrence_offset: 0,
            valid_from: '2026-01-01',
            valid_to: null,
          },
          teacher_ids: [TEACHER_2_ID],
          warnings: [],
        },
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
          id: 'p2',
          sequence: 2,
          kind: 'CLASS',
          name: null,
          starts_at: '08:45:00',
          ends_at: '09:25:00',
        },
      ]),
    ),
    http.get('/api/v1/subjects', () =>
      HttpResponse.json({
        data: [{ id: 'subject-math', name_en: 'Math', name_bn: null, code: 'MATH' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

const COVERED = {
  id: 'sub-1',
  routine_slot_id: 'slot-1',
  date: '2026-10-08',
  substitute_teacher_id: TEACHER_1_ID,
  is_cancelled: false,
  reason: 'Covering for a workshop',
  created_by: 'user-2',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

function render(entry = '/routines/substitutions') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/routines/substitutions', () => {
  it('joins each record to its period, shows a status badge, and has no native select or date input', async () => {
    mockBaseData();
    server.use(
      http.get('/api/v1/routines/substitutions', () =>
        HttpResponse.json([
          COVERED,
          {
            ...COVERED,
            id: 'sub-2',
            date: '2026-10-07',
            is_cancelled: true,
            substitute_teacher_id: null,
            reason: null,
          },
          { ...COVERED, id: 'sub-3', date: '2026-10-06', routine_slot_id: 'slot-not-current' },
        ]),
      ),
    );
    const { container } = render();

    expect(await screen.findByText(formatDate('2026-10-08', REGION_BD_BN))).toBeTruthy();
    expect((await screen.findAllByText('Class 6 – B')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Mr Karim')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Covering for a workshop').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Covered').length).toBe(2);
    expect(screen.getByText('Period cancelled')).toBeTruthy();
    expect(screen.queryByText('slot-not-current')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it('picking a class writes class_id to the URL but never sends it to the API', async () => {
    mockBaseData();
    const queries: URLSearchParams[] = [];
    server.use(
      http.get('/api/v1/routines/substitutions', ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json([COVERED]);
      }),
    );
    const { router } = render(`/routines/substitutions?section_id=${SECTION_ID}`);
    const user = userEvent.setup();

    await screen.findByText('Covering for a workshop');
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 6' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ class_id: CLASS_ID }));
    expect(router.state.location.search).not.toHaveProperty('section_id');
    expect(queries.every((query) => !query.has('class_id'))).toBe(true);
  });

  it('shows "Clear filters" on an empty filtered list, and a retryable error', async () => {
    mockBaseData();
    server.use(http.get('/api/v1/routines/substitutions', () => HttpResponse.json([])));
    render(`/routines/substitutions?substitute_teacher_id=${TEACHER_1_ID}`);

    expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });

  it('shows the translated error with Retry when the list fails to load', async () => {
    mockBaseData();
    server.use(
      http.get('/api/v1/routines/substitutions', () =>
        HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 }),
      ),
    );
    render();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 8000 });
    expect(screen.getByText(/Couldn't load substitute teachers/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('opens the add-substitution dialog', async () => {
    mockBaseData();
    server.use(http.get('/api/v1/routines/substitutions', () => HttpResponse.json([])));
    render();

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'No substitute teachers' });
    await user.click(screen.getAllByRole('button', { name: /add substitute teacher/i })[0]!);

    expect(screen.getByRole('dialog', { name: /record a substitute teacher/i })).toBeTruthy();
  });
});
