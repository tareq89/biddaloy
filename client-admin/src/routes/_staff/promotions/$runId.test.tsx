import { toast } from '@biddaloy/ui/components';
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

type Entry = ReturnType<typeof entry>;
type EntryPatch = { student_id: string; final_outcome?: string; group_name?: string; override_note?: string };

/** A run server that validates entry PATCHes the way `patchEntries` does:
 * 400 on a blank note (DTO), 422 on an override with no note, a
 * non-override's note nulled, the whole batch applied or none of it. It
 * records every PATCH body and the stored run at the moment of commit. */
function statefulRun(initial: ReturnType<typeof baseRun> = baseRun()) {
  let entries = (initial.entries as Entry[]).map((row) => ({ ...row }));
  let status = 'DRAFT';
  const record = { patches: [] as EntryPatch[][], entries: () => entries, committed: null as Entry[] | null };
  const current = () => ({ ...initial, status, entries });
  server.use(
    http.get(RUN_URL, () => HttpResponse.json(current())),
    http.patch(`${RUN_URL}/entries`, async ({ request }) => {
      const body = (await request.json()) as EntryPatch[];
      record.patches.push(body);
      if (body.some((patch) => patch.override_note !== undefined && patch.override_note.trim() === '')) {
        return HttpResponse.json(apiErrorBody(400, 'Bad Request', `${RUN_URL}/entries`), { status: 400 });
      }
      const next = entries.map((row) => ({ ...row }));
      for (const patch of body) {
        const row = next.find((candidate) => candidate.student_id === patch.student_id);
        if (!row) continue;
        const finalOutcome = patch.final_outcome ?? row.final_outcome;
        const override = finalOutcome !== row.suggested_outcome;
        const note = override ? (patch.override_note ?? row.override_note) : null;
        if (override && !note) {
          return HttpResponse.json(apiErrorBody(422, 'Unprocessable Entity', `${RUN_URL}/entries`), {
            status: 422,
          });
        }
        Object.assign(row, {
          final_outcome: finalOutcome,
          is_override: override,
          override_note: note,
          ...(patch.group_name !== undefined ? { group_name: patch.group_name } : {}),
        });
      }
      entries = next;
      return HttpResponse.json(current());
    }),
    http.post(`${RUN_URL}/commit`, () => {
      record.committed = entries.map((row) => ({ ...row }));
      status = 'COMMITTED';
      return HttpResponse.json(current());
    }),
  );
  return record;
}

function renderRun() {
  renderWithRouter(routeTree, {
    initialEntries: ['/promotions/run-1'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('/promotions/$runId', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('R on a promoted row marks the override and focuses the note; clearing the note shows the error', async () => {
    const user = userEvent.setup();
    stubCommon();
    statefulRun();
    renderRun();

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

  async function overrideWithNote(user: ReturnType<typeof userEvent.setup>) {
    const outcomeCell = await screen.findByLabelText('Final');
    outcomeCell.focus();
    await user.keyboard('r');
    const note = await screen.findByLabelText('Override note');
    await waitFor(() => expect(document.activeElement).toBe(note));
    await user.keyboard('Weak in maths');
    return outcomeCell;
  }

  it('saves an override together with its note, in one request', async () => {
    const user = userEvent.setup();
    stubCommon();
    const record = statefulRun();
    renderRun();

    await overrideWithNote(user);

    await waitFor(() => expect(record.patches).toHaveLength(1), { timeout: 2000 });
    expect(record.patches[0]).toEqual([
      { student_id: 's1', final_outcome: 'RETAIN', override_note: 'Weak in maths' },
    ]);
    expect(record.entries()[0]).toMatchObject({ final_outcome: 'RETAIN', override_note: 'Weak in maths' });
  });

  it('reverting to the suggested outcome drops the pending note save', async () => {
    const user = userEvent.setup();
    stubCommon();
    const record = statefulRun();
    renderRun();

    const outcomeCell = await overrideWithNote(user);
    outcomeCell.focus();
    await user.keyboard('p');

    await waitFor(() => expect(record.patches).toHaveLength(1));
    await sleep(700);
    expect(record.patches).toEqual([[{ student_id: 's1', final_outcome: 'PROMOTE' }]]);
    expect(record.entries()[0]).toMatchObject({ final_outcome: 'PROMOTE', override_note: null });
  });

  it('flushes a note still in its debounce before committing', async () => {
    const user = userEvent.setup();
    stubCommon();
    const record = statefulRun();
    renderRun();

    await overrideWithNote(user);
    await user.keyboard('{Control>}{Enter}{/Control}');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Commit' }));

    await waitFor(() => expect(record.committed).not.toBeNull());
    expect(record.committed?.[0]).toMatchObject({ final_outcome: 'RETAIN', override_note: 'Weak in maths' });
  });

  it('keeps the stored note when an overridden row switches to another override', async () => {
    const user = userEvent.setup();
    stubCommon();
    const record = statefulRun(
      baseRun({ entries: [entry({ final_outcome: 'RETAIN', is_override: true, override_note: 'old' })] }),
    );
    renderRun();

    const outcomeCell = await screen.findByLabelText('Final');
    outcomeCell.focus();
    await user.keyboard('g');

    await waitFor(() =>
      expect(record.patches).toEqual([
        [{ student_id: 's1', final_outcome: 'GRADUATE', override_note: 'old' }],
      ]),
    );
  });

  it('reports a failed save and does not commit', async () => {
    const user = userEvent.setup();
    const toastError = vi.spyOn(toast, 'error');
    stubCommon();
    const record = statefulRun();
    server.use(
      http.patch(`${RUN_URL}/entries`, () =>
        HttpResponse.json(apiErrorBody(500, 'Internal Server Error', `${RUN_URL}/entries`), {
          status: 500,
        }),
      ),
    );
    renderRun();

    await overrideWithNote(user);
    await user.keyboard('{Control>}{Enter}{/Control}');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Commit' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Could not save this change. Please try again.'),
    );
    expect(record.committed).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
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

  // Only the commit endpoint returns these codes — so drive a real commit
  // (Ctrl+Enter → confirm) rather than faking them on the entries PATCH.
  async function commitAndGetConflict(code: 'STALE_RESULTS' | 'COHORT_CHANGED') {
    const user = userEvent.setup();
    stubCommon();
    server.use(
      http.get(RUN_URL, () => HttpResponse.json(baseRun())),
      http.post(`${RUN_URL}/commit`, () =>
        HttpResponse.json(
          { ...apiErrorBody(409, 'Conflict', `${RUN_URL}/commit`), details: { code } },
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
    await user.keyboard('{Control>}{Enter}{/Control}');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Commit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }

  it('shows the stale-results banner when commit returns STALE_RESULTS', async () => {
    await commitAndGetConflict('STALE_RESULTS');
    await screen.findByText('Results changed since this preview — refresh');
  });

  it('tells the user to start over when commit returns COHORT_CHANGED', async () => {
    await commitAndGetConflict('COHORT_CHANGED');
    await screen.findByText(/Delete this draft and create a new run/);
    expect(screen.queryByText('Results changed since this preview — refresh')).toBeNull();
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
