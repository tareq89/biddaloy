/**
 * [16.7.5] Schedule detail page (`/fees/schedules/$id`) — exclusions
 * management plus the schedule-scoped run-history table added in the
 * #822 review pass (see `$id.tsx`'s own doc comment on
 * `recurring_schedule_id` scoping).
 */
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The default test RegionConfig is Bangla; pin REGION_BD_EN for this page so assertions read in
// Latin digits.
vi.mock('@biddaloy/ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/i18n')>();
  return { ...actual, useRegionConfig: () => actual.REGION_BD_EN };
});

import { routeTree } from '../../../../routeTree.gen';

function scheduleDetailFixture(overrides: Record<string, unknown> = {}) {
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
    exclusions: [],
    ...overrides,
  };
}

function paginatedGenerations(rows: Record<string, unknown>[] = []) {
  return { data: rows, total: rows.length, page: 1, limit: 10 };
}

function renderScheduleDetail(options: {
  schedule?: Record<string, unknown>;
  generations?: Record<string, unknown>[];
  scheduleStatus?: number;
  role?: string;
}) {
  const schedule = options.schedule ?? scheduleDetailFixture();
  server.use(
    http.get('/api/v1/fees/schedules/:id', () => {
      if (options.scheduleStatus) {
        return HttpResponse.json(
          apiErrorBody(options.scheduleStatus, 'Not found', '/api/v1/fees/schedules/x'),
          { status: options.scheduleStatus },
        );
      }
      return HttpResponse.json(schedule);
    }),
    http.get('/api/v1/fees/generations', ({ request }) => {
      const url = new URL(request.url);
      // Confirms $id.tsx actually sends the schedule-scoping filter added
      // alongside the run-history fix, not just a source: 'SCHEDULE' filter.
      expect(url.searchParams.get('recurring_schedule_id')).toBe(schedule.id as string);
      expect(url.searchParams.get('source')).toBe('SCHEDULE');
      expect(url.searchParams.get('limit')).toBe('25');
      return HttpResponse.json(paginatedGenerations(options.generations ?? []));
    }),
  );

  return renderWithRouter(routeTree, {
    initialEntries: [`/fees/schedules/${schedule.id as string}`],
    tenantId: 'tenant-1',
    role: options.role ?? 'ADMIN',
    locale: 'en',
  });
}

describe('fees/schedules/$id', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the schedule name, exclusions section and an empty run-history state', async () => {
    renderScheduleDetail({});

    // One h1 — the rule name — and no back link.
    expect(await screen.findByRole('heading', { level: 1, name: 'Monthly tuition' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /Back to schedules/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Excluded students' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Billing history' })).toBeTruthy();
    expect(await screen.findByText("This schedule hasn't generated any fees yet")).toBeTruthy();
  });

  it('says what the rule does in the header facts', async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [
            { id: 'year-1', name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
          ],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/fee-structures', () =>
        HttpResponse.json({
          data: [{ id: 'fee-1', name: 'Tuition', amount: '1500', class_id: null }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );
    renderScheduleDetail({});

    await screen.findByRole('heading', { level: 1, name: 'Monthly tuition' });
    expect(await screen.findByText('2026-2027')).toBeTruthy();
    expect(screen.getByText('Every month on day 1')).toBeTruthy();
    expect(screen.getByText('7 days after the period starts')).toBeTruthy();
    expect(screen.getByText('From 1st January, 2026')).toBeTruthy();
    expect(await screen.findByText('Tuition (৳1,500.00)')).toBeTruthy();
  });

  it('opens the rule form through ?edit=1 from the single primary Edit button', async () => {
    const { router } = renderScheduleDetail({});
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ edit: 1 }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Edit automatic billing rule' }),
    ).toBeTruthy();
  });

  it('shows no Edit button for a role that cannot manage schedules', async () => {
    renderScheduleDetail({ role: 'EXECUTIVE' });

    // EXECUTIVE cannot reach the route at all; the page shows the refusal, never an Edit button.
    await screen.findByText("You don't have access to this page.");
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('shows a Retry button when the schedule fails to load', async () => {
    renderScheduleDetail({ scheduleStatus: 404 });

    expect(await screen.findByText("Couldn't load automatic billing rules")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('scopes run-history to this schedule and renders a returned batch', async () => {
    renderScheduleDetail({
      generations: [
        {
          id: 'batch-1',
          academic_year_id: 'year-1',
          period_start: '2026-07-01',
          period_type: 'MONTH',
          due_date: '2026-07-10',
          source: 'SCHEDULE',
          duplicate_strategy: 'SKIP',
          notify_families: true,
          student_count: 2,
          generated_count: 2,
          skipped_count: 0,
          removed_count: 0,
          structures: [],
          created_at: '2026-07-01T00:00:00.000Z',
          generated_by: null,
          billed_amount: 2000,
          collected_amount: 2000,
          collection_status: 'FULL',
        },
      ],
    });

    await screen.findByRole('heading', { name: 'Monthly tuition' });
    // The history is a month name (the round's own period), never an ISO date.
    expect(await screen.findByText('July 2026')).toBeTruthy();
    // Proves the recurring_schedule_id filter round-trips end to end: this
    // only passes once the msw handler's own assertion (that the request
    // actually carried the filter) has passed, and the empty-state message
    // is gone because a real row came back.
    await waitFor(() =>
      expect(screen.queryByText("This schedule hasn't generated any fees yet")).toBeNull(),
    );
  });

  it('shows exclusions with a reason and the exclude control gated on canManage', async () => {
    renderScheduleDetail({
      schedule: scheduleDetailFixture({
        exclusions: [{ student_id: 'student-1', student_name: 'Rahim Uddin', reason: 'Sibling' }],
      }),
    });

    await screen.findByRole('heading', { name: 'Monthly tuition' });
    expect(screen.getByText('Rahim Uddin')).toBeTruthy();
    expect(screen.getByText('Sibling')).toBeTruthy();
    // ADMIN has SCHEDULE_MANAGE (the route's own guard already requires it
    // for anyone to reach this page), so the remove-exclusion action shows.
    expect(screen.getByRole('button', { name: 'Include again' })).toBeTruthy();
  });
});
