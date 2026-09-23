import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
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
    expect(cell.value).toBe('90');

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
