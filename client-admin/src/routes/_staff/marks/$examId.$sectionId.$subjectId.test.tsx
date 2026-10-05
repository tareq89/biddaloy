import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const GRID_URL = '/api/v1/exams/exam-1/marks';

const baseGrid = {
  exam_id: 'exam-1',
  section_id: 'sec-1',
  subject_id: 'subj-1',
  state: 'DRAFT' as const,
  submitted_by: null,
  submitted_at: null,
  students: [{ id: 's1', roll_number: 1, full_name: 'Rafi Ahmed' }],
  components: [
    {
      id: 'c1',
      name: 'Written',
      kind: 'WRITTEN',
      source: 'MANUAL',
      full_marks: '100',
      pass_marks: null,
      sequence: 1,
    },
  ],
  cells: [],
  derived: {},
};

describe('/marks/$examId/$sectionId/$subjectId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the save-state header and moves saving -> saved after a batch commits', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(GRID_URL, () => HttpResponse.json(baseGrid)),
      http.patch(GRID_URL, async ({ request }) => {
        const body = (await request.json()) as { cells: Array<Record<string, unknown>> };
        return HttpResponse.json({
          cells: body.cells.map((cell) => ({ ...cell, saved_at: new Date().toISOString() })),
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByText('No changes yet');
    const cell = await screen.findByLabelText('Rafi Ahmed — Written');
    await user.type(cell, '90');

    // Debounced batch fires ~600ms after the last keystroke, then the
    // header settles on the authoritative "saved" line.
    await within(screen.getByTestId('save-state-line')).findByText(/All changes saved/, undefined, {
      timeout: 3000,
    });
  });

  it('shows "Saving…" while a batch is in flight', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(GRID_URL, () => HttpResponse.json(baseGrid)),
      http.patch(GRID_URL, async ({ request }) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const body = (await request.json()) as { cells: Array<Record<string, unknown>> };
        return HttpResponse.json({
          cells: body.cells.map((cell) => ({ ...cell, saved_at: new Date().toISOString() })),
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const cell = await screen.findByLabelText('Rafi Ahmed — Written');
    await user.type(cell, '90');

    await within(screen.getByTestId('save-state-line')).findByText(/Saving/, undefined, {
      timeout: 3000,
    });
    await within(screen.getByTestId('save-state-line')).findByText(/All changes saved/, undefined, {
      timeout: 3000,
    });
  });

  it("keeps a failed save's value in the cell and keeps retrying", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    server.use(
      http.get(GRID_URL, () => HttpResponse.json(baseGrid)),
      http.patch(GRID_URL, async ({ request }) => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        const body = (await request.json()) as { cells: Array<Record<string, unknown>> };
        return HttpResponse.json({
          cells: body.cells.map((cell) => ({ ...cell, saved_at: new Date().toISOString() })),
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const cell = await screen.findByLabelText<HTMLInputElement>('Rafi Ahmed — Written');
    await user.type(cell, '90');

    await within(screen.getByTestId('save-state-line')).findByText(/not saved/, undefined, {
      timeout: 2000,
    });
    // Never discarded — the typed value stays in the cell.
    // The cell re-renders the kept value in the region's numerals.
    expect(cell.value).toBe(formatNumber(90, REGION_BD_BN));

    await within(screen.getByTestId('save-state-line')).findByText(/All changes saved/, undefined, {
      timeout: 5000,
    });
  });

  it('submit dialog shows the blank count and the grid becomes read-only afterwards', async () => {
    const user = userEvent.setup();
    let state: 'DRAFT' | 'SUBMITTED' = 'DRAFT';
    server.use(
      http.get(GRID_URL, () => HttpResponse.json({ ...baseGrid, state })),
      http.post(`${GRID_URL}/submit`, () => {
        state = 'SUBMITTED';
        return HttpResponse.json({
          ...baseGrid,
          state: 'SUBMITTED',
          submitted_by: 'user-1',
          submitted_at: new Date().toISOString(),
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByLabelText('Rafi Ahmed — Written');
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await screen.findByText('1 blank cells will be submitted as-is.');

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await screen.findByText(/submitted by/i);
    const submittedCell = screen.getByLabelText<HTMLInputElement>('Rafi Ahmed — Written');
    expect(submittedCell.disabled).toBe(true);
  });

  // Submit locks the grid, so a mark typed just before it must be saved
  // first — and the blank count must reflect it, not the page-load grid.
  it('submitting right after typing saves the mark first and counts it as filled', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    let state: 'DRAFT' | 'SUBMITTED' = 'DRAFT';
    server.use(
      http.get(GRID_URL, () => HttpResponse.json({ ...baseGrid, state })),
      http.patch(GRID_URL, async ({ request }) => {
        calls.push('save');
        const body = (await request.json()) as { cells: Array<Record<string, unknown>> };
        return HttpResponse.json({
          cells: body.cells.map((cell) => ({ ...cell, saved_at: new Date().toISOString() })),
        });
      }),
      http.post(`${GRID_URL}/submit`, () => {
        calls.push('submit');
        state = 'SUBMITTED';
        return HttpResponse.json({
          ...baseGrid,
          state: 'SUBMITTED',
          submitted_by: 'user-1',
          submitted_at: new Date().toISOString(),
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('Rafi Ahmed — Written'), '90');
    // Well inside the 600ms debounce — nothing has been saved yet.
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await screen.findByRole('heading', { name: 'Submit this grid?' });
    expect(screen.queryByText(/blank cells will be submitted/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await screen.findByText(/submitted by/i);
    expect(calls).toEqual(['save', 'submit']);
  });

  it('does not submit when saving the pending marks fails', async () => {
    const user = userEvent.setup();
    let submitted = false;
    server.use(
      http.get(GRID_URL, () => HttpResponse.json(baseGrid)),
      http.patch(GRID_URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
      http.post(`${GRID_URL}/submit`, () => {
        submitted = true;
        return HttpResponse.json({ ...baseGrid, state: 'SUBMITTED' });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('Rafi Ahmed — Written'), '90');
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await screen.findByRole('heading', { name: 'Submit this grid?' });
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    // The dialog closes so the header's "not saved" line is visible.
    await within(screen.getByTestId('save-state-line')).findByText(/not saved/);
    expect(screen.queryByRole('heading', { name: 'Submit this grid?' })).toBeNull();
    expect(submitted).toBe(false);
  });

  it('a submitted grid a teacher opens is read-only from the start', async () => {
    server.use(
      http.get(GRID_URL, () =>
        HttpResponse.json({
          ...baseGrid,
          state: 'SUBMITTED',
          submitted_by: 'user-1',
          submitted_at: '2026-01-01T00:00:00.000Z',
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const cell = await screen.findByLabelText<HTMLInputElement>('Rafi Ahmed — Written');
    expect(cell.disabled).toBe(true);
    // A plain teacher has no Reopen action.
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
  });

  it('an exam controller (view only) sees an unsubmitted grid read-only with no submit', async () => {
    const user = userEvent.setup();
    server.use(http.get(GRID_URL, () => HttpResponse.json(baseGrid)));

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'EXAM_CONTROLLER',
      locale: 'en',
    });

    const cell = await screen.findByLabelText<HTMLInputElement>('Rafi Ahmed — Written');
    expect(cell.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
    // The Ctrl+Enter shortcut is gated the same way as the button.
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.queryByRole('heading', { name: 'Submit this grid?' })).toBeNull();
  });

  it('a teacher can edit an unsubmitted grid and Ctrl+Enter opens submit', async () => {
    const user = userEvent.setup();
    server.use(http.get(GRID_URL, () => HttpResponse.json(baseGrid)));

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const cell = await screen.findByLabelText<HTMLInputElement>('Rafi Ahmed — Written');
    expect(cell.disabled).toBe(false);
    await user.keyboard('{Control>}{Enter}{/Control}');
    await screen.findByRole('heading', { name: 'Submit this grid?' });
  });

  it('an admin sees a Reopen action on a submitted grid', async () => {
    server.use(
      http.get(GRID_URL, () =>
        HttpResponse.json({
          ...baseGrid,
          state: 'SUBMITTED',
          submitted_by: 'user-1',
          submitted_at: '2026-01-01T00:00:00.000Z',
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('button', { name: 'Reopen' });
  });
});
