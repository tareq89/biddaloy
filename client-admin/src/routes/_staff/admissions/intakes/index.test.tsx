import { toast } from '@biddaloy/ui/components';
import {
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/**
 * [27.9] Admission intakes staff screen. Every case names a `role` since
 * `/admissions/intakes` sits under `_staff` and is gated by
 * `ADMISSION_REVIEW` (`route-permissions.ts`).
 */
describe('/admissions/intakes', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  const klass = classFactory({ id: 'class-1', name: 'Class 5' });
  const section = classSectionFactory({
    id: 'section-1',
    class: klass,
    class_id: klass.id,
    section_name: 'A',
  });

  // The picker opens on the current month, so tests pick day-of-this-month cells.
  const now = new Date();
  const iso = (day: number) =>
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  async function pickDate(
    user: ReturnType<typeof userEvent.setup>,
    scope: ReturnType<typeof within>,
    label: string,
    day: number,
  ) {
    await user.click(scope.getByRole('button', { name: label }));
    const cell = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(`[data-date="${iso(day)}"]`);
      if (!el) throw new Error('calendar not open');
      return el;
    });
    await user.click(cell);
  }

  function mockClassAndSection() {
    server.use(
      http.get('/api/v1/classes', ({ request }) =>
        HttpResponse.json({
          data: [klass],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
          ...{ url: request.url },
        }),
      ),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
    );
  }

  it('creates an intake and shows it in the list', async () => {
    mockClassAndSection();
    let intakes: unknown[] = [];
    server.use(
      http.get('/api/v1/admission-intakes', () => HttpResponse.json(intakes)),
      http.post('/api/v1/admission-intakes', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        const created = {
          id: 'intake-1',
          ...body,
          status: 'OPEN',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        };
        intakes = [created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/intakes'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Admission rounds' });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Add admission round' }))[0]!);

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByRole('textbox', { name: /^Title/ }), 'Class 5 intake 2026');
    await user.click(dialog.getByRole('combobox', { name: /^Class \/ Section/ }));
    await user.click(await screen.findByRole('option', { name: 'Class 5 · A' }));
    await user.type(dialog.getByRole('spinbutton', { name: /^Seat count/ }), '30');
    await pickDate(user, dialog, 'Open date', 10);
    await pickDate(user, dialog, 'Close date', 20);
    // Toggle a required document type on, then off — exercises both branches
    // of toggleDocumentType, not just the "never touched" default.
    const photoCheckbox = dialog.getByRole('checkbox', { name: 'Photo' });
    await user.click(photoCheckbox);
    await user.click(photoCheckbox);
    await user.click(dialog.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Class 5 intake 2026')).toBeTruthy();
  });

  it('lists names, formatted seats and dates, and row links - never an id or ISO date', async () => {
    mockClassAndSection();
    server.use(
      http.get('/api/v1/admission-intakes', () =>
        HttpResponse.json([
          {
            id: 'intake-1',
            title: 'Class 5 intake 2026',
            class_section_id: 'section-1',
            class_name: 'Class 5',
            section_name: 'A',
            seat_count: 30,
            open_date: '2026-01-10',
            close_date: '2026-02-20',
            required_document_types: [],
            status: 'OPEN',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/intakes'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect((await screen.findAllByText('Class 5 · A')).length).toBeGreaterThan(0);
    expect(screen.queryByText('section-1')).toBeNull();
    expect(screen.queryByText(/2026-01-10/)).toBeNull();
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('link', { name: 'View applicants' })[0]?.getAttribute('href'),
    ).toContain('/admissions/applicants?intakeId=intake-1');
    expect(screen.getAllByRole('link', { name: 'Edit' })[0]?.getAttribute('href')).toBe(
      '/admissions/intakes/intake-1',
    );
  });

  it('shows a real empty state with an add action', async () => {
    mockClassAndSection();
    server.use(http.get('/api/v1/admission-intakes', () => HttpResponse.json([])));

    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/intakes'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('No admission rounds yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add admission round' }).length).toBe(2);
  });

  it('editing an intake saves the change', async () => {
    mockClassAndSection();
    const intake = {
      id: 'intake-1',
      title: 'Original title',
      class_section_id: section.id,
      seat_count: 20,
      open_date: '2026-01-01',
      close_date: '2026-02-01',
      required_document_types: [],
      status: 'OPEN',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    server.use(
      http.get('/api/v1/admission/applicants', () =>
        HttpResponse.json([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]),
      ),
      http.get('/api/v1/admission-intakes/:id', () => HttpResponse.json(intake)),
      http.patch('/api/v1/admission-intakes/:id', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        Object.assign(intake, body);
        return HttpResponse.json(intake);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/intakes/intake-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const titleInput = await screen.findByRole('textbox', { name: /^Title/ });
    await waitFor(() => expect((titleInput as HTMLInputElement).value).toBe('Original title'));
    // crumbless shell check: header has the title, a status badge and the applicants link
    expect(screen.getByRole('heading', { level: 1, name: 'Original title' })).toBeTruthy();
    expect(screen.getByText('3 applications received')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View applicants' }).getAttribute('href')).toContain(
      '/admissions/applicants?intakeId=intake-1',
    );
    expect(document.querySelector('input[type="date"]')).toBeNull();

    const toastSuccess = vi.spyOn(toast, 'success');
    const user = userEvent.setup();
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated title');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(intake.title).toBe('Updated title'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Saved'));
  });

  it('Cancel on the round page returns to the list', async () => {
    mockClassAndSection();
    server.use(
      http.get('/api/v1/admission-intakes/:id', () =>
        HttpResponse.json({
          id: 'intake-1',
          title: 'Original title',
          class_section_id: section.id,
          seat_count: 20,
          open_date: '2026-01-01',
          close_date: '2026-02-01',
          required_document_types: [],
          status: 'OPEN',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        }),
      ),
      http.get('/api/v1/admission-intakes', () => HttpResponse.json([])),
      http.get('/api/v1/admission/applicants', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/intakes/intake-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('textbox', { name: /^Title/ });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Admission rounds' })).toBeTruthy();
  });

  it('disables Create when close date is before open date', async () => {
    mockClassAndSection();
    server.use(http.get('/api/v1/admission-intakes', () => HttpResponse.json([])));

    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/intakes'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Admission rounds' });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Add admission round' }))[0]!);

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByRole('textbox', { name: /^Title/ }), 'Class 5 intake 2026');
    await user.click(dialog.getByRole('combobox', { name: /^Class \/ Section/ }));
    await user.click(await screen.findByRole('option', { name: 'Class 5 · A' }));
    await user.type(dialog.getByRole('spinbutton', { name: /^Seat count/ }), '30');
    await pickDate(user, dialog, 'Open date', 20);
    await pickDate(user, dialog, 'Close date', 10);

    expect(dialog.getByText('Close date must not be before open date.')).toBeTruthy();
    expect(dialog.getByRole<HTMLButtonElement>('button', { name: 'Create' }).disabled).toBe(true);
  });

  it('shows an error state instead of spinning forever when the intake fails to load', async () => {
    mockClassAndSection();
    server.use(
      http.get('/api/v1/admission-intakes/:id', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/intakes/intake-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('Failed to save admission round')).toBeTruthy();
  });

  it('refuses the whole route for TEACHER, who lacks ADMISSION_REVIEW', async () => {
    mockClassAndSection();
    server.use(http.get('/api/v1/admission-intakes', () => HttpResponse.json([])));

    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/intakes'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Admission rounds' })).toBeNull();
  });
});
