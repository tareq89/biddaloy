import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  examFactory,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** [26.6.1] `/promotions/new` — see the `## Plan — #1003` GitHub comment
 * for the full design this covers: the `?classId=` prefill, D13's
 * suggested-but-editable target class, D14's per-reason blocking, D21's
 * published-only exam list, and D8's BLOCK/SNAKE choice. */
describe('/promotions/new', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const year2026 = academicYearFactory({
    id: 'year-2026',
    name: '2026-2027',
    start_date: '2026-01-01T00:00:00.000Z',
  });
  const year2027 = academicYearFactory({
    id: 'year-2027',
    name: '2027-2028',
    start_date: '2027-01-01T00:00:00.000Z',
  });
  const class6 = classFactory({
    id: 'class-6',
    name: 'Class 6',
    academic_year: year2026,
    academic_year_id: year2026.id,
  });
  const class7 = classFactory({
    id: 'class-7',
    name: 'Class 7',
    academic_year: year2027,
    academic_year_id: year2027.id,
  });

  function stubBase(overrides: { suggestion?: object } = {}) {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [year2026, year2027],
          total: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes', ({ request }) => {
        const url = new URL(request.url);
        const academicYearId = url.searchParams.get('academic_year_id');
        const data = academicYearId
          ? [class6, class7].filter((c) => c.academic_year_id === academicYearId)
          : [class6, class7];
        return HttpResponse.json({ data, total: data.length, page: 1, limit: 100, totalPages: 1 });
      }),
      http.get('/api/v1/promotions/suggest-target', () =>
        HttpResponse.json(
          overrides.suggestion ?? {
            target_class: { id: class7.id, name: class7.name },
            retain_class: null,
            sections: [],
          },
        ),
      ),
      http.get('/api/v1/exams', () =>
        HttpResponse.json({
          data: [
            examFactory({
              id: 'exam-draft',
              name: 'Draft exam',
              status: 'DRAFT',
              class: class6,
              class_id: class6.id,
              academic_year: year2026,
              academic_year_id: year2026.id,
            }),
            examFactory({
              id: 'exam-processed',
              name: 'Processed exam',
              status: 'PROCESSED',
              class: class6,
              class_id: class6.id,
              academic_year: year2026,
              academic_year_id: year2026.id,
            }),
            examFactory({
              id: 'exam-published',
              name: 'Published exam',
              status: 'PUBLISHED',
              class: class6,
              class_id: class6.id,
              academic_year: year2026,
              academic_year_id: year2026.id,
            }),
          ],
          total: 3,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );
  }

  it('prefills the source class from ?classId=', async () => {
    stubBase();
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=class-6'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const sourceClassSelect = await screen.findByRole('combobox', { name: 'Source class' });
    await within(sourceClassSelect).findByText('Class 6 (2026-2027)');
  });

  it('defaults the target year to the next year by start_date', async () => {
    stubBase();
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=class-6'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const targetYearSelect = await screen.findByRole('combobox', { name: 'Target academic year' });
    await within(targetYearSelect).findByText('2027-2028');
  });

  it('shows the suggested target class', async () => {
    stubBase();
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=class-6'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const targetClassSelect = await screen.findByRole('combobox', { name: 'Target class' });
    await within(targetClassSelect).findByText('Class 7');
  });

  it('only lists PUBLISHED exams, preselected', async () => {
    stubBase();
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=class-6'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const checkbox = await screen.findByRole('checkbox', { name: /Published exam/ });
    expect(checkbox).toBeTruthy();
    expect(screen.queryByText('Draft exam')).toBeNull();
    expect(screen.queryByText('Processed exam')).toBeNull();
    expect((checkbox as HTMLInputElement).getAttribute('aria-checked')).not.toBe('false');
  });

  it('disables submit once every exam is unchecked', async () => {
    const user = userEvent.setup();
    stubBase();
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=class-6'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const checkbox = await screen.findByRole('checkbox', { name: /Published exam/ });
    await user.click(checkbox);

    await screen.findByText('Select at least one exam.');
    expect(screen.getByRole('button', { name: 'Create run' }).hasAttribute('disabled')).toBe(true);
  });

  it('blocks submit and shows the classes link for a blocking reason', async () => {
    stubBase({
      suggestion: {
        target_class: null,
        retain_class: null,
        sections: [],
        blocking_reason: 'TARGET_SECTIONS_MISSING',
      },
    });
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=class-6'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText(
      'The target class has no sections yet — create at least one before running this.',
    );
    const link = await screen.findByRole('link', { name: /Open classes for/ });
    expect(link.getAttribute('href')).toBe(`/classes?academic_year_id=${year2027.id}`);
    expect(screen.getByRole('button', { name: 'Create run' }).hasAttribute('disabled')).toBe(true);
  });

  it('unblocks PICK_TARGET_CLASS once a target class is picked', async () => {
    const user = userEvent.setup();
    stubBase({
      suggestion: {
        target_class: null,
        retain_class: null,
        sections: [],
        blocking_reason: 'PICK_TARGET_CLASS',
      },
    });
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=class-6'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Choose a target class, or graduate the source class.');
    expect(screen.getByRole('button', { name: 'Create run' }).hasAttribute('disabled')).toBe(true);

    const targetClassSelect = screen.getByRole('combobox', { name: 'Target class' });
    await user.click(targetClassSelect);
    await user.click(await screen.findByRole('option', { name: 'Class 7' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create run' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
  });

  it('submits the right body', async () => {
    const user = userEvent.setup();
    stubBase();
    let posted: unknown;
    server.use(
      http.post('/api/v1/promotions', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: 'run-new' }, { status: 201 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=class-6'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const targetClassSelect = await screen.findByRole('combobox', { name: 'Target class' });
    await within(targetClassSelect).findByText('Class 7');
    await user.click(screen.getByRole('radio', { name: 'Snake (balance across sections)' }));

    const submit = await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Create run' });
      expect(button.hasAttribute('disabled')).toBe(false);
      return button;
    });
    await user.click(submit);

    await waitFor(() =>
      expect(posted).toEqual({
        source_class_id: 'class-6',
        target_academic_year_id: 'year-2027',
        exam_ids: ['exam-published'],
        algorithm: 'SNAKE',
        target_class_id: 'class-7',
      }),
    );
  });
});
