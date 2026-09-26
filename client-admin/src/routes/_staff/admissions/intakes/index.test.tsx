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
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/**
 * [27.9] Admission intakes staff screen. Every case names a `role` since
 * `/admissions/intakes` sits under `_staff` and is gated by
 * `ADMISSION_REVIEW` (`route-permissions.ts`).
 */
describe('/admissions/intakes', () => {
  afterEach(async () => {
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

    await screen.findByRole('heading', { name: 'Admission intakes' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add intake' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText('Title'), 'Class 5 intake 2026');
    await user.click(dialog.getByLabelText('Class / Section'));
    await user.click(await screen.findByRole('option', { name: 'Class 5 · A' }));
    await user.type(dialog.getByLabelText('Seat count'), '30');
    await user.type(dialog.getByLabelText('Open date'), '2026-01-01');
    await user.type(dialog.getByLabelText('Close date'), '2026-02-01');
    await user.click(dialog.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Class 5 intake 2026')).toBeTruthy();
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

    const titleInput = await screen.findByLabelText('Title');
    await waitFor(() => expect((titleInput as HTMLInputElement).value).toBe('Original title'));

    const user = userEvent.setup();
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated title');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(intake.title).toBe('Updated title'));
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

    await screen.findByRole('heading', { name: 'Admission intakes' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add intake' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText('Title'), 'Class 5 intake 2026');
    await user.click(dialog.getByLabelText('Class / Section'));
    await user.click(await screen.findByRole('option', { name: 'Class 5 · A' }));
    await user.type(dialog.getByLabelText('Seat count'), '30');
    await user.type(dialog.getByLabelText('Open date'), '2026-02-01');
    await user.type(dialog.getByLabelText('Close date'), '2026-01-01');

    expect(dialog.getByText('Close date must not be before open date.')).toBeTruthy();
    expect((dialog.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
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

    expect(await screen.findByText('Failed to save admission intake')).toBeTruthy();
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
    expect(screen.queryByRole('heading', { name: 'Admission intakes' })).toBeNull();
  });
});
