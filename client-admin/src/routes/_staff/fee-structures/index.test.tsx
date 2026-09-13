/**
 * [8.11.5]'s list page — real `ListShell`/`DataTable` against the real
 * route tree, same reasoning as `students/index.test.tsx`'s own header
 * comment. Every case carries `role`, since `/fee-structures` sits under
 * `_staff`.
 */
import { FeeType } from '@biddaloy/shared';
import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  errorHandler,
  feeStructureFactory,
  renderWithRouter,
  server,
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
      class: KLASS,
      class_id: KLASS.id,
      section: null,
      section_id: null,
      academic_year: YEAR,
      academic_year_id: YEAR.id,
    });
    server.use(listHandler([row]), ...referenceHandlers());

    render();

    await screen.findByRole('heading', { name: 'Fee Structures' });
    const dataRow = within((await screen.findAllByRole('row'))[1] as HTMLElement);
    expect(dataRow.getByText('Class 9 tuition')).toBeTruthy();
    expect(dataRow.getByText('Monthly tuition')).toBeTruthy();
    expect(dataRow.getByText('৳1,500.50')).toBeTruthy();
    expect(dataRow.getByText('Class 9')).toBeTruthy();
  });

  // [16.1.2] dropped per-student targeting: a structure with no class is
  // school-wide, not "whole class" — the list must say so rather than
  // rendering a blank cell.
  it('labels a school-wide structure (no class) instead of a blank cell', async () => {
    server.use(
      listHandler([
        feeStructureFactory({ id: 's-1', name: 'Admission fee', class: null, class_id: null }),
      ]),
      ...referenceHandlers(),
    );

    render();

    expect(await screen.findByText('Whole school')).toBeTruthy();
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

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        academic_year_id: 'year-1',
        class_id: 'class-9',
      }),
    );
    await waitFor(() =>
      expect(lastQuery).toMatchObject({
        academic_year_id: 'year-1',
        class_id: 'class-9',
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

  // [8.14.10]: `useFeeStructures`'s `search`/`fee_type`/`section_id` filters
  // were already server-supported ([8.14.9]) but never surfaced as
  // FilterBar descriptors — this covers all three now reaching the
  // request/URL, plus the section list staying empty until a class is
  // chosen (same contract as `fees/dues.tsx`'s own pair).
  it('surfaces search/fee type/section filters on the request and URL', async () => {
    let lastQuery: Record<string, string> = {};
    server.use(
      http.get('/api/v1/fee-structures', ({ request }) => {
        lastQuery = Object.fromEntries(new URL(request.url).searchParams);
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([{ id: 'section-a', section_name: 'A', enrolled_count: 0 }]),
      ),
      ...referenceHandlers(),
    );

    const { router } = render();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Fee Structures' });

    await user.click(screen.getByRole('combobox', { name: 'Section' }));
    expect(screen.queryAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Escape}');

    await user.type(screen.getByRole('textbox', { name: 'Search fee structures' }), 'tuition');
    await user.click(screen.getByRole('combobox', { name: 'Fee type' }));
    await user.click(await screen.findByRole('option', { name: 'Monthly tuition' }));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        search: 'tuition',
        fee_type: 'MONTHLY_TUITION',
      }),
    );
    await waitFor(() =>
      expect(lastQuery).toMatchObject({
        search: 'tuition',
        fee_type: 'MONTHLY_TUITION',
      }),
    );
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

  // `UpdateFeeStructureDto` accepts no `academic_year_id`, so the UI must not
  // offer it — `class_id`/`section_id` stay patchable in edit mode.
  it('disables only the academic year on edit and PATCHes class/section', async () => {
    const row = feeStructureFactory({
      id: 'structure-1',
      name: 'Monthly tuition',
      class: KLASS,
      class_id: KLASS.id,
      academic_year: YEAR,
      academic_year_id: YEAR.id,
    });
    let body: Record<string, unknown> | null = null;
    server.use(
      listHandler([row]),
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
    expect(dialog.getByRole('combobox', { name: 'Class' })).toHaveProperty('disabled', false);

    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({ class_id: KLASS.id, section_id: null });
    // Never patchable — the dialog must not send it even though it knows it.
    expect(body).not.toHaveProperty('academic_year_id');
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
