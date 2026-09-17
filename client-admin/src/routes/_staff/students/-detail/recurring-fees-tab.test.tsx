import {
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [16.7.5]'s Recurring-fees tab — real route tree via `/students/$studentId`
 * (same reasoning `fees-tab.test.tsx` gives for its own tab test), since
 * `RecurringFeesTab` is only ever mounted through that route's tab wiring.
 *
 * Every mock below mirrors the shipped server contract (#675) exactly:
 * `GET /students/:id/schedules` returns a flat `StudentScheduleItemDto[]`
 * with an `excluded` flag (not a pre-split `{ included, excluded }`), and
 * `GET /fees/schedules` returns a bare array (not a paginated envelope).
 * The earlier fixtures mocked the client's hand-typed interim shapes, so
 * these tests passed against a contract the server never spoke. */
describe('students/-detail/recurring-fees-tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  /** A row of `GET /students/:id/schedules`. */
  function coverageItem(overrides: Record<string, unknown> = {}) {
    return {
      id: 'schedule-1',
      name: 'Monthly tuition',
      period_type: 'MONTH',
      due_days_after_period_start: 7,
      is_active: true,
      excluded: false,
      ...overrides,
    };
  }

  /** A row of `GET /fees/schedules` (`RecurringScheduleResponseDto`). */
  function scheduleFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'schedule-1',
      name: 'Monthly tuition',
      academic_year_id: 'year-1',
      fee_structure_ids: ['fee-1'],
      audience: { enrollment_status: 'ACTIVE' },
      rule: { kind: 'MONTHLY', day_of_month: 1 },
      period_type: 'MONTH',
      due_days_after_period_start: 7,
      starts_on: '2026-01-01',
      ends_on: '',
      notify_families: false,
      is_active: true,
      last_run_period: null,
      created_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function renderRecurringFeesTab(options: {
    student?: Record<string, unknown>;
    coverage?: unknown[];
    activeSchedules?: unknown[];
    role?: string;
  }) {
    const student =
      options.student ??
      studentFactory({
        id: 'student-1',
        full_name: 'Rahim Uddin',
        class_section_id: 'section-1',
        enrollment_status: 'ACTIVE',
      });
    const coverage = options.coverage ?? [];
    const activeSchedules = options.activeSchedules ?? [];

    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/students/:studentId/schedules', () => HttpResponse.json(coverage)),
      http.get('/api/v1/fees/schedules', () => HttpResponse.json(activeSchedules)),
    );

    return renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=recurring-fees'],
      tenantId: 'tenant-1',
      role: options.role ?? 'ADMIN',
      locale: 'en',
    });
  }

  it('splits the flat coverage list into included and excluded by the `excluded` flag', async () => {
    renderRecurringFeesTab({
      coverage: [
        coverageItem({ id: 'included-1', name: 'Included schedule', excluded: false }),
        coverageItem({ id: 'excluded-1', name: 'Excluded schedule', excluded: true }),
      ],
    });

    await screen.findByRole('tab', { name: 'Recurring fees', selected: true });

    expect(await screen.findByText('Included schedule')).toBeTruthy();
    expect(await screen.findByText('Excluded schedule')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Exclude schedule' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Include again' })).toBeTruthy();
  });

  it('excluding a schedule posts a non-empty reason, which the server requires', async () => {
    let excludedBody: Record<string, unknown> | undefined;
    renderRecurringFeesTab({
      coverage: [coverageItem({ id: 'included-1', name: 'Included schedule' })],
    });
    server.use(
      http.post('/api/v1/fees/schedules/included-1/exclusions', async ({ request }) => {
        excludedBody = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(null, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    await screen.findByText('Included schedule');
    await user.click(screen.getByRole('button', { name: 'Exclude schedule' }));

    // `AddExclusionDto.reason` is `@IsNotEmpty()`, so submit stays disabled
    // until a reason is typed rather than 400ing after a round trip.
    const submit = screen.getByRole('button', { name: 'Exclude schedule' });
    expect(submit.hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByLabelText('Reason'), 'Sibling discount');
    await user.click(screen.getByRole('button', { name: 'Exclude schedule' }));

    await waitFor(() => expect(excludedBody).toBeDefined());
    expect(excludedBody).toEqual({ student_id: 'student-1', reason: 'Sibling discount' });
  });

  it('including an excluded schedule again calls the remove-exclusion endpoint', async () => {
    let removeCalled = false;
    renderRecurringFeesTab({
      coverage: [coverageItem({ id: 'excluded-1', name: 'Excluded schedule', excluded: true })],
    });
    server.use(
      http.delete('/api/v1/fees/schedules/excluded-1/exclusions/student-1', () => {
        removeCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    await screen.findByText('Excluded schedule');
    await user.click(screen.getByRole('button', { name: 'Include again' }));

    await waitFor(() => expect(removeCalled).toBe(true));
  });

  it('offers only "Bill one-off" for an uncovered schedule, since there is no add-to-schedule endpoint', async () => {
    renderRecurringFeesTab({
      student: studentFactory({
        id: 'student-1',
        full_name: 'Rahim Uddin',
        class_section: classSectionFactory({ id: 'section-1', class_id: 'class-1' }),
        class_section_id: 'section-1',
        enrollment_status: 'ACTIVE',
      }),
      activeSchedules: [
        scheduleFixture({
          id: 'addable-1',
          name: 'Matching schedule',
          audience: { class_id: 'class-1', enrollment_status: 'ACTIVE' },
        }),
      ],
    });

    await screen.findByText('Matching schedule');
    expect(screen.queryByRole('button', { name: 'Add schedule' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Bill one-off' })).toBeTruthy();
  });

  it('explains the mismatch when the audience does not match the student', async () => {
    renderRecurringFeesTab({
      student: studentFactory({
        id: 'student-1',
        full_name: 'Rahim Uddin',
        class_section: classSectionFactory({ id: 'section-1', class_id: 'class-1' }),
        class_section_id: 'section-1',
        enrollment_status: 'ACTIVE',
      }),
      activeSchedules: [
        scheduleFixture({
          id: 'mismatched-1',
          name: 'Mismatched schedule',
          audience: { class_id: 'other-class', enrollment_status: 'ACTIVE' },
        }),
      ],
    });

    await screen.findByText('Mismatched schedule');
    expect(screen.getByRole('button', { name: 'Bill one-off' })).toBeTruthy();
    expect(
      screen.getByText(
        'This student doesn\'t match this schedule\'s audience — use "Bill one-off" instead.',
      ),
    ).toBeTruthy();
  });

  it('"Bill one-off" opens the Generate fees modal pre-selected to this student', async () => {
    renderRecurringFeesTab({
      student: studentFactory({
        id: 'student-1',
        full_name: 'Rahim Uddin',
        class_section: classSectionFactory({ id: 'section-1', class_id: 'class-1' }),
        class_section_id: 'section-1',
        enrollment_status: 'ACTIVE',
      }),
      activeSchedules: [
        scheduleFixture({
          id: 'mismatched-1',
          name: 'Mismatched schedule',
          audience: { class_id: 'other-class', enrollment_status: 'ACTIVE' },
        }),
      ],
    });
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 }),
      ),
    );

    const user = userEvent.setup();
    await screen.findByText('Mismatched schedule');
    await user.click(screen.getByRole('button', { name: 'Bill one-off' }));

    const dialog = await screen.findByRole('dialog');
    // Pre-selection seeds `selectedStudents` with this one student — the
    // modal's own "N selected" summary is how that seeding surfaces in
    // the UI, matching `generate-fees-modal.test.tsx`'s own assertion
    // shape for the same counter.
    expect(await within(dialog).findByText('1 selected')).toBeTruthy();
  });

  it('hides schedule-management actions for a role without SCHEDULE_MANAGE', async () => {
    renderRecurringFeesTab({
      role: 'TEACHER',
      coverage: [coverageItem({ id: 'included-1', name: 'Included schedule' })],
    });

    await screen.findByText('Included schedule');
    expect(screen.queryByRole('button', { name: 'Exclude schedule' })).toBeNull();
  });
});
