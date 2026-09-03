/**
 * [8.11.5]'s list page — real `ListShell`/`DataTable` against the real
 * route tree, same reasoning as `students/index.test.tsx`'s own header
 * comment. Every case carries `role`, since `/fee-structures` sits under
 * `_staff`.
 */
import { FeeApplicability, FeeType } from '@biddaloy/shared';
import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  errorHandler,
  feeStructureFactory,
  feeStructureStudentFactory,
  renderWithRouter,
  server,
  studentFactory,
  type FeeStructure,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const YEAR = academicYearFactory({ id: 'year-1', name: '2026-2027' });
const KLASS = classFactory({ id: 'class-9', name: 'Class 9', academic_year: YEAR });

function listHandler(rows: FeeStructure[]) {
  return http.get('/api/v1/fee-structures', () =>
    HttpResponse.json({ data: rows, total: rows.length, page: 1, limit: 10, totalPages: 1 }),
  );
}

/** The default school-settings fixture is a 0-decimal, Bengali-numeral
 * tenant, which would make every money assertion below either identity
 * (minor units == taka) or Bengali-script. These tests are about the
 * paisa conversion and Latin grouping specifically, so they pin a
 * 2-decimal, Latin-numeral region instead. */
function paisaRegionHandler() {
  return http.get('/api/v1/schools/:id/settings', () =>
    HttpResponse.json({
      version: 1,
      region: {
        locale: 'en-BD',
        currency: {
          code: 'BDT',
          symbol: '\u09f3',
          position: 'prefix',
          decimals: 2,
          grouping: 'lakh-crore',
        },
        numerals: 'latin',
      },
      communications: {},
    }),
  );
}

function referenceHandlers() {
  return [
    paisaRegionHandler(),
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({ data: [YEAR], total: 1, page: 1, limit: 10, totalPages: 1 }),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({ data: [KLASS], total: 1, page: 1, limit: 100, totalPages: 1 }),
    ),
  ];
}

function render(role: 'ADMIN' | 'ACCOUNTANT' | 'TEACHER' = 'ADMIN', entry = '/fee-structures') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

describe('/fee-structures', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders every column, formatting the server’s decimal-string amount for the region', async () => {
    const row = feeStructureFactory({
      id: 'structure-1',
      name: 'Class 9 tuition',
      fee_type: FeeType.MONTHLY_TUITION,
      // The server serializes `decimal(10,2)` as a **string** — the page
      // must format it, not `parseFloat` it.
      amount: '1500.50' as unknown as number,
      applicability: FeeApplicability.ALL,
      class: KLASS,
      class_id: KLASS.id,
      section: null,
      section_id: null,
      academic_year: YEAR,
      academic_year_id: YEAR.id,
      month: 1,
      is_recurring: true,
    });
    server.use(listHandler([row]), ...referenceHandlers());

    render();

    await screen.findByRole('heading', { name: 'Fee Structures' });
    const dataRow = within((await screen.findAllByRole('row'))[1] as HTMLElement);
    expect(dataRow.getByText('Class 9 tuition')).toBeTruthy();
    expect(dataRow.getByText('Monthly tuition')).toBeTruthy();
    expect(dataRow.getByText('৳1,500.50')).toBeTruthy();
    expect(dataRow.getByText('Class 9')).toBeTruthy();
    // A recurring structure's `month` is an effective-from marker.
    expect(dataRow.getByText('From January')).toBeTruthy();
    expect(dataRow.getByText('Whole class')).toBeTruthy();
  });

  // The AC is "recurring structures visually distinguished without relying
  // on colour", so this asserts the badge's *text*, never its tone class.
  it('distinguishes recurring from one-time structures by badge text', async () => {
    server.use(
      listHandler([
        feeStructureFactory({ id: 's-1', name: 'Tuition', is_recurring: true, class: KLASS }),
        feeStructureFactory({ id: 's-2', name: 'Exam', is_recurring: false, class: KLASS }),
      ]),
      ...referenceHandlers(),
    );

    render();

    await screen.findByRole('heading', { name: 'Fee Structures' });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    const rows = screen.getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText('Recurring')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('One time')).toBeTruthy();
  });

  it('names the exact count of selected students when the server supplies them', async () => {
    server.use(
      listHandler([
        feeStructureFactory({
          id: 's-1',
          applicability: FeeApplicability.SELECTED,
          class: KLASS,
          selected_students: [feeStructureStudentFactory(), feeStructureStudentFactory()],
        }),
      ]),
      ...referenceHandlers(),
    );

    render();

    expect(await screen.findByText('2 selected students')).toBeTruthy();
  });

  // The contract-compliant list response: `findAll` omits the
  // `selected_students` relation deliberately, so the column has no count to
  // show and must degrade to the generic label rather than inventing a number
  // or rendering "0 selected students".
  it('falls back to a generic label when the list omits selected_students', async () => {
    server.use(
      listHandler([
        feeStructureFactory({
          id: 's-1',
          applicability: FeeApplicability.SELECTED,
          class: KLASS,
        }),
      ]),
      ...referenceHandlers(),
    );

    render();

    expect(await screen.findByText('Selected students')).toBeTruthy();
  });

  it('shows the empty state when the tenant has no fee structures', async () => {
    server.use(listHandler([]), ...referenceHandlers());

    render();

    expect(await screen.findByText('No fee structures found')).toBeTruthy();
  });

  it('puts the chosen filters on the request and in the URL', async () => {
    let lastQuery: Record<string, string> = {};
    server.use(
      http.get('/api/v1/fee-structures', ({ request }) => {
        lastQuery = Object.fromEntries(new URL(request.url).searchParams);
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
      ...referenceHandlers(),
    );

    const { router } = render();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Fee Structures' });

    await user.click(screen.getByRole('combobox', { name: 'Academic year' }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 9' }));
    await user.click(screen.getByRole('combobox', { name: 'Month' }));
    await user.click(await screen.findByRole('option', { name: 'March' }));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        academic_year_id: 'year-1',
        class_id: 'class-9',
        month: '3',
      }),
    );
    await waitFor(() =>
      expect(lastQuery).toMatchObject({
        academic_year_id: 'year-1',
        class_id: 'class-9',
        month: '3',
      }),
    );
  });

  // Regression: clearing a filter used to drop the key from the object it
  // handed `setFilters`, and an absent key leaves the URL param untouched —
  // so "All academic years" was a no-op and the list stayed filtered with no
  // way back except hand-editing the URL.
  it('clears a filter back to "all" once one is applied', async () => {
    server.use(listHandler([]), ...referenceHandlers());

    const { router } = render('ADMIN', '/fee-structures?academic_year_id=year-1');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Fee Structures' });

    await user.click(screen.getByRole('combobox', { name: 'Academic year' }));
    await user.click(await screen.findByRole('option', { name: 'All academic years' }));

    await waitFor(() =>
      expect(router.state.location.search).not.toHaveProperty('academic_year_id'),
    );
  });

  // Regression: `month` was a free string, so a hand-edited URL reached
  // `Number(month)` as `NaN`, went out as `month=NaN`, and came back a 400.
  it('ignores an out-of-range month in the URL instead of erroring', async () => {
    let lastQuery: Record<string, string> = {};
    server.use(
      http.get('/api/v1/fee-structures', ({ request }) => {
        lastQuery = Object.fromEntries(new URL(request.url).searchParams);
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
      ...referenceHandlers(),
    );

    render('ADMIN', '/fee-structures?month=abc');

    expect(await screen.findByText('No fee structures found')).toBeTruthy();
    expect(lastQuery).not.toHaveProperty('month');
  });

  it('refuses to submit the create form without a name', async () => {
    server.use(listHandler([]), ...referenceHandlers());

    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add fee structure' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(await dialog.findByText('Name is required')).toBeTruthy();
  });

  // The captured POST body is the point: `MoneyInput` works in integer
  // minor units, the DTO's `amount` is decimal taka, so ৳1,500.50 has to
  // reach the server as `1500.5` — not `150050`, and not a float artifact.
  it('converts the typed amount to decimal taka in the create request', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      listHandler([]),
      http.post('/api/v1/fee-structures', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(feeStructureFactory({ id: 'new-structure' }), { status: 201 });
      }),
      ...referenceHandlers(),
    );

    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add fee structure' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText('Name'), 'Monthly tuition');
    await user.type(dialog.getByLabelText('Amount'), '1500.50');
    await user.click(dialog.getByRole('combobox', { name: 'Academic year' }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    await user.click(dialog.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 9' }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({
      name: 'Monthly tuition',
      amount: 1500.5,
      academic_year_id: 'year-1',
      class_id: 'class-9',
    });
  });

  it('surfaces a server failure on create instead of closing the dialog', async () => {
    server.use(
      listHandler([]),
      errorHandler('post', '/api/v1/fee-structures', 404),
      ...referenceHandlers(),
    );

    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add fee structure' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText('Name'), 'Monthly tuition');
    await user.type(dialog.getByLabelText('Amount'), '500');
    await user.click(dialog.getByRole('combobox', { name: 'Academic year' }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    await user.click(dialog.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 9' }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(await dialog.findByText('Failed to save fee structure')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  // `UpdateFeeStructureDto` accepts neither field, so the UI must not
  // offer them — and `student_ids` goes up as a full replacement set.
  it('disables year and class on edit, prefills the picker, and PATCHes the full student set', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    const row = feeStructureFactory({
      id: 'structure-1',
      name: 'Monthly tuition',
      applicability: FeeApplicability.SELECTED,
      class: KLASS,
      class_id: KLASS.id,
      academic_year: YEAR,
      academic_year_id: YEAR.id,
    });
    let body: Record<string, unknown> | null = null;
    server.use(
      listHandler([row]),
      http.get('/api/v1/fee-structures/:id', () =>
        HttpResponse.json({
          ...row,
          selected_students: [feeStructureStudentFactory({ student, student_id: student.id })],
        }),
      ),
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.patch('/api/v1/fee-structures/:id', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(row);
      }),
      ...referenceHandlers(),
    );

    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('combobox', { name: 'Academic year' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(dialog.getByRole('combobox', { name: 'Class' })).toHaveProperty('disabled', true);
    // Prefilled from the detail response's `selected_students`.
    await dialog.findByText('1 student selected');

    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({ student_ids: ['student-1'] });
    // Never patchable — the dialog must not send them even though it knows them.
    expect(body).not.toHaveProperty('class_id');
    expect(body).not.toHaveProperty('academic_year_id');
  });

  // Regression: `student_ids` is a full replacement set, so submitting an
  // edit before the detail response lands would send the interim selection
  // and silently unlink every student already attached. Save stays blocked
  // until the current set is known.
  it('blocks saving an edit until the existing student selection has loaded', async () => {
    const row = feeStructureFactory({
      id: 'structure-1',
      applicability: FeeApplicability.SELECTED,
      class: KLASS,
      class_id: KLASS.id,
      academic_year: YEAR,
      academic_year_id: YEAR.id,
    });
    let patched = false;
    server.use(
      listHandler([row]),
      // Never resolves within the test — stands in for a slow detail load.
      http.get('/api/v1/fee-structures/:id', () => new Promise(() => {})),
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.patch('/api/v1/fee-structures/:id', () => {
        patched = true;
        return HttpResponse.json(row);
      }),
      ...referenceHandlers(),
    );

    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const dialog = within(await screen.findByRole('dialog'));
    const save = await dialog.findByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);

    await user.click(save);
    expect(patched).toBe(false);
  });

  // Regression: switching SELECTED → ALL used to omit `student_ids`, so the
  // server's replace-the-set branch never ran and the pivot rows survived.
  // Switching back would then silently re-check the "removed" students.
  // "All sections" had the same shape of bug: an omitted `section_id` leaves
  // the column untouched, so a section-scoped structure could never be
  // widened back to the whole class.
  it('sends an empty student set and a null section when switching to whole-class', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    const row = feeStructureFactory({
      id: 'structure-1',
      name: 'Monthly tuition',
      applicability: FeeApplicability.SELECTED,
      class: KLASS,
      class_id: KLASS.id,
      academic_year: YEAR,
      academic_year_id: YEAR.id,
    });
    let body: Record<string, unknown> | null = null;
    server.use(
      listHandler([row]),
      http.get('/api/v1/fee-structures/:id', () =>
        HttpResponse.json({
          ...row,
          selected_students: [feeStructureStudentFactory({ student, student_id: student.id })],
        }),
      ),
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.patch('/api/v1/fee-structures/:id', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(row);
      }),
      ...referenceHandlers(),
    );

    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findByText('1 student selected');

    await user.click(dialog.getByRole('combobox', { name: 'Applies to' }));
    await user.click(await screen.findByRole('option', { name: 'Every student in the class' }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({ student_ids: [], section_id: null });
  });

  it('names the real side effect in the delete dialog and removes the row on success', async () => {
    let rows = [feeStructureFactory({ id: 'structure-1', name: 'Delete Me', class: KLASS })];
    server.use(
      http.get('/api/v1/fee-structures', () =>
        HttpResponse.json({ data: rows, total: rows.length, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.delete('/api/v1/fee-structures/:id', () => {
        rows = [];
        return new HttpResponse(null, { status: 204 });
      }),
      ...referenceHandlers(),
    );

    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    const dialog = within(await screen.findByRole('dialog'));
    // The copy must describe what actually happens: generated fees survive.
    expect(dialog.getByText(/stay exactly as they are/i)).toBeTruthy();

    await user.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('No fee structures found')).toBeTruthy();
  });

  it('explains a 409 on delete and leaves the row in place', async () => {
    server.use(
      listHandler([feeStructureFactory({ id: 'structure-1', name: 'Protected', class: KLASS })]),
      errorHandler('delete', '/api/v1/fee-structures/:id', 409),
      ...referenceHandlers(),
    );

    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    expect(await dialog.findByText(/payments have already been recorded/i)).toBeTruthy();
    expect(screen.getByText('Protected')).toBeTruthy();
  });

  // [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses the whole
  // route for a TEACHER, who holds no `FEE_STRUCTURE_READ` (deliberately
  // — see `ROLE_PERMISSIONS[TEACHER]`'s own comment) — before this
  // ticket the route still rendered for them with every write button
  // hidden, a partial view [8.14.17] intentionally replaces with a
  // blanket refusal.
  it('refuses the whole route for a TEACHER, who lacks FEE_STRUCTURE_READ', async () => {
    server.use(
      listHandler([feeStructureFactory({ id: 'structure-1', class: KLASS })]),
      ...referenceHandlers(),
    );

    render('TEACHER');

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Fee Structures' })).toBeNull();
  });

  // The controller lets an ACCOUNTANT create and update but reserves
  // DELETE for ADMIN — the UI gate has to match that split exactly.
  it('lets an ACCOUNTANT create and edit but not delete', async () => {
    server.use(
      listHandler([feeStructureFactory({ id: 'structure-1', class: KLASS })]),
      ...referenceHandlers(),
    );

    render('ACCOUNTANT');

    expect(await screen.findByRole('button', { name: 'Add fee structure' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('renders a Bangla-script fee name', async () => {
    server.use(
      listHandler([feeStructureFactory({ id: 'structure-1', class: KLASS }, 'bn')]),
      ...referenceHandlers(),
    );

    render();

    expect(await screen.findByText('মাসিক বেতন')).toBeTruthy();
  });

  it('is axe clean', async () => {
    server.use(
      listHandler([feeStructureFactory({ id: 'structure-1', name: 'Tuition', class: KLASS })]),
      ...referenceHandlers(),
    );

    const { container } = render();

    // Waits for real content, not just the shell — an empty table would
    // pass trivially.
    await screen.findByText('Tuition');
    await expect(container).toHaveNoViolations();
  });

  // [8.14.10]: FilterBar migration — the rows-per-page control changes
  // `limit` and resets `page` in one URL update.
  it('changing rows per page writes limit and resets page', async () => {
    server.use(
      http.get('/api/v1/fee-structures', () =>
        HttpResponse.json({ data: [], total: 0, page: 2, limit: 10, totalPages: 1 }),
      ),
      ...referenceHandlers(),
    );

    const { router } = render('ADMIN', '/fee-structures?page=2');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Fee Structures' });
    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    await user.click(await screen.findByRole('option', { name: '20' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ limit: 20, page: 1 }));
  });

  // [8.14.10]: `sorting={null}`/no-op `onSortingChange` used to be a
  // deliberate stub — `sort`/`order` now exist server-side, so clicking a
  // sortable header threads them through to the request.
  it('clicking the Name column header writes sort/order to the URL', async () => {
    server.use(
      http.get('/api/v1/fee-structures', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
      ...referenceHandlers(),
    );

    const { router } = render();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Fee Structures' });
    await user.click(screen.getByRole('button', { name: 'Name' }));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ sort: 'name', order: 'desc' }),
    );
  });
});
