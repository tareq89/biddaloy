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

  it('copies the public admission link from the live site address', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    server.use(
      http.get('/api/v1/admission-intakes', () => HttpResponse.json([])),
      http.get('/api/v1/website', () => HttpResponse.json({ has_published: true })),
      http.get('/api/v1/website/preview-token', () =>
        HttpResponse.json({ url: 'https://demo-school.example.test/?preview=t' }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/intakes'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await user.click((await screen.findAllByRole('button', { name: 'Copy public link' }))[0]!);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://demo-school.example.test/admission'),
    );
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

    const row = within(await screen.findByRole('table'));
    expect(row.getByText('Class 5')).toBeTruthy();
    expect(row.getByText('Open')).toBeTruthy();
    expect(screen.queryByText('section-1')).toBeNull();
    expect(screen.queryByText(/2026-01-10/)).toBeNull();
    expect(row.getByRole('link', { name: 'Open desk' }).getAttribute('href')).toBe(
      '/admissions/rounds/intake-1',
    );
    expect(row.getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe(
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
    expect(screen.getByRole('button', { name: 'Add admission round' })).toBeTruthy();
    expect(
      screen.getAllByRole('link', { name: 'Add admission round' })[0]!.getAttribute('href'),
    ).toBe('/admissions/intakes/new');
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
        HttpResponse.json({ data: [{ id: 'a1' }], total: 3, page: 1, limit: 1, totalPages: 3 }),
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
    expect(screen.getByText('৩ applications received')).toBeTruthy();
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

  it('prints the applicant count in the tenant numerals (Bangla digits in bn)', async () => {
    mockClassAndSection();
    server.use(
      http.get('/api/v1/admission/applicants', () =>
        HttpResponse.json({ data: [{ id: 'a1' }], total: 3, page: 1, limit: 1, totalPages: 3 }),
      ),
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
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/intakes/intake-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'bn',
    });
    expect(await screen.findByText('৩টি আবেদন জমা পড়েছে')).toBeTruthy();
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
      http.get('/api/v1/admission/applicants', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 }),
      ),
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

    expect(await screen.findByText('Failed to load this round')).toBeTruthy();
    expect(screen.queryByText('Failed to save admission round')).toBeNull();
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
