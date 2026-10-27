import { HomeworkGradingMode } from '@biddaloy/shared';
import {
  apiErrorBody,
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const notifyOutcome = vi.hoisted(() => vi.fn());
vi.mock('@biddaloy/ui/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@biddaloy/ui/api')>()),
  notifyOutcome,
}));

describe('/academics/homework/$homeworkId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const sectionRow = {
    id: 'a1',
    homework_id: 'hw-1',
    section_id: 'section-1',
    student_id: null,
    assigned_date: '2026-10-20',
    due_date: '2026-10-30',
    status: 'ACTIVE',
    target_section_id: 'section-1',
    section_name: 'A',
    student_name: null,
  };

  // Default is one live row: an empty list repeats the "Assign" button in its empty state.
  const assignmentsHandler = (rows: unknown[] = [sectionRow]) =>
    http.get('/api/v1/homework/:id/assignments', () => HttpResponse.json(rows));

  const homework = {
    id: 'hw-1',
    subject_id: 'subject-1',
    class_id: 'class-1',
    title: 'Algebra worksheet',
    description: 'Chapter 3 exercises',
    grading_mode: HomeworkGradingMode.TICK,
    attachments: [],
    created_at: '2026-09-01T00:00:00.000Z',
  };

  it('renders title, grading mode and description', async () => {
    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler(),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/hw-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Algebra worksheet' });
    expect(screen.getByText('Chapter 3 exercises')).toBeTruthy();
    expect(screen.getByText('Tick (done / not done)')).toBeTruthy();
    expect(screen.getByText(/2026/)).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('404 shows an error state', async () => {
    server.use(
      http.get('/api/v1/homework/:id', () =>
        HttpResponse.json(apiErrorBody(404, 'Not found', '/api/v1/homework/missing'), {
          status: 404,
        }),
      ),
      assignmentsHandler(),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/missing'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('We could not find this record')).toBeTruthy();
  });

  it('assign dialog submits and shows a confirmation', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-1', section_name: 'A', class: klass });
    let assignBody: Record<string, unknown> | undefined;

    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler(),
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('/api/v1/homework/:id/assign', async ({ request }) => {
        assignBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          id: 'assignment-1',
          homework_id: 'hw-1',
          section_id: assignBody.section_id,
          student_id: null,
          assigned_date: assignBody.assigned_date,
          due_date: assignBody.due_date,
          status: 'ACTIVE',
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/hw-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Assign to section or student' }));

    await screen.findByRole('dialog');
    await user.click(screen.getByRole('combobox', { name: /^Section/ }));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(assignBody).toBeDefined());
    expect(assignBody?.section_id).toBe(section.id);
    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' })),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a failed assign shows the generic error, not the server message', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-1', section_name: 'A', class: klass });

    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler(),
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('/api/v1/homework/:id/assign', () =>
        HttpResponse.json(apiErrorBody(400, 'internal backend detail', '/x'), { status: 400 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/hw-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Assign to section or student' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('combobox', { name: /^Section/ }));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByText('internal backend detail')).toBeNull();
  });

  const renderAdmin = () =>
    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/hw-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

  it('a live row has a Change button, a superseded row does not', async () => {
    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler([sectionRow, { ...sectionRow, id: 'a0', status: 'SUPERSEDED' }]),
    );

    renderAdmin();

    expect(await screen.findAllByRole('button', { name: 'Change Section A' })).toHaveLength(1);
  });

  it('lists names, dates and status, never ids', async () => {
    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler([
        sectionRow,
        {
          ...sectionRow,
          id: 'a2-student-row-id',
          section_id: null,
          student_id: 'st-1',
          section_name: 'B',
          student_name: 'Rahim Uddin',
        },
        { ...sectionRow, id: 'a0-old-row-id', status: 'SUPERSEDED' },
      ]),
    );

    renderAdmin();

    expect((await screen.findAllByText('Section A')).length).toBeGreaterThan(0);
    expect(screen.getByText('Rahim Uddin · Section B')).toBeTruthy();
    expect(screen.getByText('Superseded')).toBeTruthy();
    expect(screen.getAllByText(/30/).length).toBeGreaterThan(0);
    expect(screen.queryByText('a2-student-row-id')).toBeNull();
    expect(screen.queryByText('section-1')).toBeNull();
  });

  it('Change opens a prefilled dialog, saves over the row and confirms', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-1', section_name: 'A', class: klass });
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler(),
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('/api/v1/homework-assignments/:id/reassign', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...sectionRow, id: 'a9', ...body });
      }),
    );

    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change Section A' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({
      section_id: 'section-1',
      assigned_date: '2026-10-20',
      due_date: '2026-10-30',
    });
    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' })),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a failed Change shows the generic error and refetches the list', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-1', section_name: 'A', class: klass });
    let listCalls = 0;
    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      http.get('/api/v1/homework/:id/assignments', () => {
        listCalls += 1;
        return HttpResponse.json([sectionRow]);
      }),
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('/api/v1/homework-assignments/:id/reassign', () =>
        HttpResponse.json(apiErrorBody(400, 'internal backend detail', '/x'), { status: 400 }),
      ),
    );

    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change Section A' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByText('internal backend detail')).toBeNull();
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));
  });

  it('an empty list says nobody has the homework yet', async () => {
    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler([]),
    );

    renderAdmin();

    expect(await screen.findByText('Not given to anyone yet')).toBeTruthy();
  });
});
