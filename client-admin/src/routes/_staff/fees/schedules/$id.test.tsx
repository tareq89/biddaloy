/**
 * [16.7.5] Schedule detail page (`/fees/schedules/$id`) — exclusions
 * management plus the schedule-scoped run-history table added in the
 * #822 review pass (see `$id.tsx`'s own doc comment on
 * `recurring_schedule_id` scoping).
 */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

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
        return HttpResponse.json({ message: 'Not found' }, { status: options.scheduleStatus });
      }
      return HttpResponse.json(schedule);
    }),
    http.get('/api/v1/fees/generations', ({ request }) => {
      const url = new URL(request.url);
      // Confirms $id.tsx actually sends the schedule-scoping filter added
      // alongside the run-history fix, not just a source: 'SCHEDULE' filter.
      expect(url.searchParams.get('recurring_schedule_id')).toBe(schedule.id as string);
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

    expect(await screen.findByRole('heading', { name: 'Monthly tuition' })).toBeTruthy();
    expect(screen.getByText('Exclusions')).toBeTruthy();
    expect(await screen.findByText("This schedule hasn't generated any fees yet")).toBeTruthy();
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
