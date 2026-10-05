import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  examFactory,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** [19.6.1] Exams list — same `ListShell`-against-the-real-route-tree
 * pattern `classes/index.test.tsx` uses. */
describe('/exams', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists exams with class, year, kind and a status badge, plus view/edit actions', async () => {
    const year = academicYearFactory({ id: 'year-1', name: '2026-2027', is_current: true });
    const exam = examFactory({
      id: 'exam-1',
      name: 'Half Yearly 2026',
      kind: 'TERM',
      status: 'DRAFT',
      academic_year: year,
      academic_year_id: year.id,
      class: classFactory({ id: 'class-7', name: 'Class 7' }),
    });
    const examParams: URLSearchParams[] = [];
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [year], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/exams', ({ request }) => {
        examParams.push(new URL(request.url).searchParams);
        return HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 25, totalPages: 1 });
      }),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/exams'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Exams' });
    await screen.findByText('Half Yearly 2026');
    const row = screen.getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getByText('Class 7')).toBeTruthy();
    expect(await within(row).findByText('2026-2027')).toBeTruthy();
    expect(within(row).getByText('Term')).toBeTruthy();
    expect(within(row).getByText('Draft')).toBeTruthy();
    expect(within(row).queryByText('DRAFT')).toBeNull();
    expect(
      within(row).getByRole('link', { name: 'View' }).getAttribute('href'),
    ).toBe('/exams/exam-1');
    expect(examParams.at(-1)?.get('limit')).toBe('25');

    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Edit exam')).toBeTruthy();
    expect(within(dialog).getByLabelText('Name')).toHaveProperty('value', 'Half Yearly 2026');
  });

  it('class filter waits for a year, then sends class_id', async () => {
    const user = userEvent.setup();
    const year = academicYearFactory({ id: 'year-1', name: '2026-2027' });
    const examParams: URLSearchParams[] = [];
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [year], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({
          data: [classFactory({ id: 'class-7', name: 'Class 7' })],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/exams', ({ request }) => {
        examParams.push(new URL(request.url).searchParams);
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 });
      }),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/exams'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Exams' });
    // No year yet: the class control offers only the hint, no class.
    const classTrigger = await screen.findByRole('combobox', { name: 'Class' });
    expect(classTrigger.textContent).toContain('Pick an academic year first');

    await user.click(screen.getByRole('combobox', { name: 'Academic year' }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    await user.click(await screen.findByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 7' }));
    await waitFor(() => expect(examParams.at(-1)?.get('class_id')).toBe('class-7'));
    expect(examParams.at(-1)?.get('academic_year_id')).toBe('year-1');
  });

  it('shows the empty state, and a no-match variant when filtered', async () => {
    const year = academicYearFactory({ id: 'year-1', name: '2026-2027' });
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [year], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 }),
      ),
    );
    const view = renderWithRouter(routeTree, {
      initialEntries: ['/exams'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByText('No exams yet');
    await act(() =>
      view.router.navigate({ to: '/exams', search: { academic_year_id: 'year-1' } }),
    );
    await screen.findByText('No exams match these filters');
  });

  it('surfaces a validation error creating an exam without a class/year', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await user.click((await screen.findAllByRole('button', { name: 'Add exam' }))[0] as HTMLElement);
    await user.type(await screen.findByLabelText('Name'), 'Model Test');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Academic year and class are required.');
  });

  it('opens the create dialog when ?create=1 is navigated to while already mounted, and clears the flag on close', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/exams'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByRole('heading', { name: 'Exams' });
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(() => router.navigate({ to: '/exams', search: { create: '1' } }));
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('create'));
  });
});
