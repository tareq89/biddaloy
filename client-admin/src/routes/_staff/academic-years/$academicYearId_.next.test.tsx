import { academicYearFactory, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** Words the epic's glossary says never to show (D-glossary: rollover, clone, idempotent...). */
const NEVER_SAY = /\b(rollover|clone|copy structure|idempotent|upsert)\b/i;

const block = (created: number, existing = 0) => ({ created, existing, skipped: [] });
const PREVIEW = {
  target_year_id: null,
  classes: block(4, 2),
  sections: block(8),
  class_subjects: block(30),
  teacher_assignments: { created: 20, existing: 0, skipped: [{ name: 'x', reason: 'no section' }] },
  fee_structures: block(6),
  grading_scales: block(1),
  terms: block(2),
  skipped_staff: [{ teacher_name: 'Rahim Uddin', section: 'Class 6 A', subject: 'Math' }],
};

let created: unknown[];

function serve(opts: { createFails?: boolean; preview?: unknown } = {}) {
  created = [];
  server.use(
    http.get('/api/v1/academic-years/:id', ({ params }) =>
      HttpResponse.json(
        academicYearFactory({
          id: params.id as string,
          name: '2026-2027',
          start_date: '2026-01-01T00:00:00.000Z',
          end_date: '2026-12-31T00:00:00.000Z',
        }),
      ),
    ),
    http.get('/api/v1/academic-years/:id/next/preview', () =>
      HttpResponse.json(opts.preview ?? PREVIEW),
    ),
    http.post('/api/v1/academic-years/:id/next', async ({ request }) => {
      created.push(await request.json());
      if (opts.createFails) {
        return HttpResponse.json({ message: 'boom', statusCode: 500 }, { status: 500 });
      }
      return HttpResponse.json({ ...PREVIEW, target_year_id: 'year-2' }, { status: 201 });
    }),
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
    ),
  );
}

function open() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/academic-years/year-1/next'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/academic-years/$academicYearId/next', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('prefills the name (+1 year) and sends the day-after / one-year dates', async () => {
    serve();
    const user = userEvent.setup();
    open();
    const name = await screen.findByLabelText<HTMLInputElement>(/Name of the new year/);
    expect(name.value).toBe('2027-2028');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('button', { name: 'Create year' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      name: '2027-2028',
      start_date: '2027-01-01',
      end_date: '2027-12-31',
    });
  });

  it('shows new / already there / skipped per block and the skipped teachers by name', async () => {
    serve();
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText('New 4 · Already there 2 · Skipped 0')).toBeTruthy();
    expect(screen.getByText('New 20 · Already there 0 · Skipped 1')).toBeTruthy();
    expect(screen.getByText(/Rahim Uddin — Class 6 A, Math/)).toBeTruthy();
  });

  it('an unticked block is left out of the POST body', async () => {
    serve();
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Fee structures' }));
    await user.click(screen.getByRole('button', { name: 'Create year' }));
    await waitFor(() => expect(created).toHaveLength(1));
    const include = (created[0] as { include: string[] }).include;
    expect(include).not.toContain('fee_structures');
    expect(include).toContain('classes');
  });

  it('a failed create says nothing was created and stays on the preview', async () => {
    serve({ createFails: true });
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('button', { name: 'Create year' }));
    expect(await screen.findByText('Nothing was created. Try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create year' })).toBeTruthy();
  });

  it('a re-run preview reads "already there" for what the year already has', async () => {
    serve({ preview: { ...PREVIEW, classes: block(0, 12) } });
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText('New 0 · Already there 12 · Skipped 0')).toBeTruthy();
  });

  it('Enter, Enter, Enter reaches Done, and no glossary never-say word appears', async () => {
    serve();
    const user = userEvent.setup();
    open();
    const name = await screen.findByLabelText(/Name of the new year/);
    await user.click(name);
    await user.keyboard('{Enter}');
    await screen.findByText(/Tick what to copy/);
    // Wait for the numbers so Create year is enabled before the second Enter.
    await screen.findByText('New 4 · Already there 2 · Skipped 0');
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('2027-2028 is ready')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(window.location.pathname).not.toContain('/next'));
  });
});
