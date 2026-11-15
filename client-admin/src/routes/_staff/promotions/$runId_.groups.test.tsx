import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** Words the epic's glossary says never to show. */
const NEVER_SAY = /\b(rollover|clone|idempotent|upsert|promotion menu)\b/i;

function row(id: string, name: string, gpa: number | null, marks: number, source: string | null) {
  return {
    entry_id: id,
    student_id: `s-${id}`,
    student_name: name,
    source_section_id: 'sec-a',
    source_section_name: 'A',
    group_name: null,
    result: {
      gpa,
      subjects: source ? [{ subject_code: 'MAT', marks, grade: 'A' }] : [],
      source,
    },
  };
}

const ALL = [
  row('e1', 'Rafi Ahmed', 5, 90, 'FINAL_RESULT'),
  row('e2', 'Mina Akter', 4.5, 70, 'FINAL_RESULT'),
  row('e3', 'Karim Uddin', 3, 40, 'FINAL_RESULT'),
];

let patches: unknown[];
let queries: string[];

function serve(opts: { groups?: string[]; rows?: typeof ALL } = {}) {
  patches = [];
  queries = [];
  const rows = opts.rows ?? ALL;
  server.use(
    http.get('/api/v1/classes/vocabulary', () =>
      HttpResponse.json({ shifts: [], versions: [], groups: opts.groups ?? ['Science', 'Arts'] }),
    ),
    http.get('/api/v1/promotions/run-1/groups', ({ request }) => {
      const url = new URL(request.url);
      queries.push(url.search);
      const min = Number(url.searchParams.get('gpa_min') ?? 0);
      const data = rows.filter((r) => (r.result.gpa ?? 0) >= min);
      return HttpResponse.json({ data, total: data.length, page: 1, limit: 50 });
    }),
    http.patch('/api/v1/promotions/run-1/groups', async ({ request }) => {
      patches.push(await request.json());
      return HttpResponse.json({ updated: 2 });
    }),
  );
}

function open() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/promotions/run-1/groups'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/promotions/$runId/groups', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('filters server-side, selects all matching and applies the group to those ids only', async () => {
    serve();
    const user = userEvent.setup();
    open();
    await screen.findByText('Rafi Ahmed');
    expect(screen.getByText('Karim Uddin')).toBeTruthy();

    await user.type(screen.getAllByLabelText('GPA from')[0]!, '4');
    await waitFor(() => expect(screen.queryByText('Karim Uddin')).toBeNull());
    expect(queries.some((q) => q.includes('gpa_min=4'))).toBe(true);

    await user.click(await screen.findByRole('button', { name: /Select all matching/ }));
    await user.click(screen.getByRole('combobox', { name: 'Group' }));
    await user.click(await screen.findByRole('option', { name: 'Science' }));
    await user.click(await screen.findByRole('button', { name: /Apply to/ }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ entry_ids: ['e1', 'e2'], group_name: 'Science' });
    expect(await screen.findByText(/Group set for .* students/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });

  it('hides the group controls with a hint when the school has no groups', async () => {
    serve({ groups: [] });
    open();
    expect(await screen.findByText('This school has no groups yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Apply to/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Group' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open school settings' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });

  it('shows only ticks (no filter) when no student has a result', async () => {
    serve({
      rows: [row('e1', 'Rafi Ahmed', null, 0, null), row('e2', 'Mina Akter', null, 0, null)],
    });
    open();
    expect(await screen.findByText('No results to filter on')).toBeTruthy();
    expect(screen.queryByLabelText('GPA from')).toBeNull();
    expect(screen.getByText('Rafi Ahmed')).toBeTruthy();
  });

  it('sends subject_code with marks_min and shows the marks column', async () => {
    serve();
    const user = userEvent.setup();
    open();
    await screen.findByText('Rafi Ahmed');
    await user.click(screen.getByRole('combobox', { name: 'Subject' }));
    await user.click(await screen.findByRole('option', { name: 'MAT' }));
    await user.type(screen.getAllByLabelText('Marks at least')[0]!, '60');
    await waitFor(() =>
      expect(
        queries.some((q) => q.includes('subject_code=MAT') && q.includes('marks_min=60')),
      ).toBe(true),
    );
    expect(await screen.findByText('MAT marks')).toBeTruthy();
  });

  it('keeps the selection and shows an error when apply fails', async () => {
    serve();
    server.use(
      http.patch('/api/v1/promotions/run-1/groups', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    open();
    await screen.findByText('Rafi Ahmed');
    await user.click(await screen.findByRole('button', { name: /Select all matching/ }));
    await user.click(screen.getByRole('combobox', { name: 'Group' }));
    await user.click(await screen.findByRole('option', { name: 'Science' }));
    const before = queries.length;
    await user.click(await screen.findByRole('button', { name: /Apply to/ }));
    expect(await screen.findByText(/Some students may already be set/)).toBeTruthy();
    // A failed chunk may follow applied ones: the rows are refetched, never left stale.
    await waitFor(() => expect(queries.length).toBeGreaterThan(before));
    expect(screen.getByRole('button', { name: /Apply to/ })).toBeTruthy();
  });
});
