import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const RUN_URL = '/api/v1/promotions/run-1';

function entry(overrides: Record<string, unknown> = {}) {
  const studentId = typeof overrides.student_id === 'string' ? overrides.student_id : 's1';
  return {
    id: `entry-${studentId}`,
    tenant_id: 'tenant-1',
    run_id: 'run-1',
    student_id: 's1',
    source_enrollment_id: 'enr-1',
    source_section_id: 'sec-src',
    merit_rank: 1,
    mean_gpa: '4.50',
    total_marks_sum: '450',
    passed_all: true,
    suggested_outcome: 'PROMOTE',
    final_outcome: 'PROMOTE',
    is_override: false,
    override_note: null,
    overridden_by_user_id: null,
    group_name: null,
    target_class_id: 'class-7',
    target_section_id: 'sec-a',
    new_roll_number: 1,
    placement_error: null,
    target_enrollment_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    student_name: 'Rafi Ahmed',
    student_roll_number: 1,
    ...overrides,
  };
}

function baseRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    tenant_id: 'tenant-1',
    source_class_id: 'class-6',
    source_academic_year_id: 'year-2026',
    target_academic_year_id: 'year-2027',
    target_class_id: 'class-7',
    exam_ids: ['exam-1'],
    algorithm: 'BLOCK',
    status: 'DRAFT',
    refreshed_at: '2026-01-01T00:00:00.000Z',
    committed_at: null,
    committed_by_user_id: null,
    approved_by_user_id: null,
    override_count: 0,
    created_by_user_id: 'user-admin',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    entries: [entry()],
    ...overrides,
  };
}

function stubCommon() {
  server.use(
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [
          { id: 'year-2026', name: '2026-2027' },
          { id: 'year-2027', name: '2027-2028' },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [
          { id: 'class-6', name: 'Class 6' },
          { id: 'class-7', name: 'Class 7' },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes/vocabulary', () => HttpResponse.json({ groups: ['Science', 'Arts'] })),
    http.get('/api/v1/classes/class-7/sections', () =>
      HttpResponse.json([{ id: 'sec-a', section_name: 'A', capacity: 40, enrolled_count: 10 }]),
    ),
  );
}

describe('/promotions/$runId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('R on a promoted row marks the override and focuses the note; clearing the note shows the error', async () => {
    const user = userEvent.setup();
    stubCommon();
    server.use(
      http.get(RUN_URL, () => HttpResponse.json(baseRun())),
      http.patch(`${RUN_URL}/entries`, () => HttpResponse.json(baseRun())),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/run-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const outcomeCell = await screen.findByLabelText('Final');
    outcomeCell.focus();
    await user.keyboard('r');

    await screen.findByText('Override');
    const note = await screen.findByLabelText('Override note');
    await waitFor(() => expect(document.activeElement).toBe(note));

    await user.click(note);
    await user.keyboard('{Backspace}');
    note.blur();
    await screen.findByText('A note is required for an override.');
  });

  it('a group change triggers an update', async () => {
    const user = userEvent.setup();
    stubCommon();
    let patchedBody: unknown;
    server.use(
      http.get(RUN_URL, () => HttpResponse.json(baseRun())),
      http.patch(`${RUN_URL}/entries`, async ({ request }) => {
        patchedBody = await request.json();
        return HttpResponse.json(baseRun());
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/run-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await user.click(await screen.findByLabelText('Group'));
    await user.click(await screen.findByText('Science'));

    await waitFor(() =>
      expect(patchedBody).toEqual([{ student_id: 's1', group_name: 'Science' }]),
    );
  });

  it('shows the stale-results banner on a 409 from the server', async () => {
    const user = userEvent.setup();
    stubCommon();
    server.use(
      http.get(RUN_URL, () => HttpResponse.json(baseRun())),
      http.patch(`${RUN_URL}/entries`, () =>
        HttpResponse.json(
          { ...apiErrorBody(409, 'Results changed', `${RUN_URL}/entries`), details: { code: 'STALE_RESULTS' } },
          { status: 409 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/run-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const outcomeCell = await screen.findByLabelText('Final');
    outcomeCell.focus();
    await user.keyboard('g');

    await screen.findByText('Results changed since this preview — refresh');
  });

  it('renders a committed run read-only', async () => {
    stubCommon();
    server.use(
      http.get(RUN_URL, () =>
        HttpResponse.json(
          baseRun({
            status: 'COMMITTED',
            committed_at: '2026-02-01T00:00:00.000Z',
            committed_by_user_id: 'user-admin',
            approved_by_user_id: 'user-admin2',
            entries: [entry({ final_outcome: 'PROMOTE' })],
          }),
        ),
      ),
      http.get('/api/v1/users/user-admin', () =>
        HttpResponse.json({ id: 'user-admin', full_name: 'Admin One' }),
      ),
      http.get('/api/v1/users/user-admin2', () =>
        HttpResponse.json({ id: 'user-admin2', full_name: 'Admin Two' }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/run-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await within(await screen.findByRole('status')).findByText(/Promoted: 1/);
    expect(screen.queryByRole('button', { name: /Commit/ })).toBeNull();
    const outcomeCell = await screen.findByLabelText('Final');
    expect(outcomeCell.getAttribute('tabindex')).toBe('-1');
    await screen.findByText(/Committed .* by Admin One, approved by Admin Two/);
  });
});
