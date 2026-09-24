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
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

describe('/academics/homework/$homeworkId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

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
    server.use(http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)));

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/hw-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Algebra worksheet' });
    expect(screen.getByText('Chapter 3 exercises')).toBeTruthy();
    expect(screen.getByText('Tick (done / not done)')).toBeTruthy();
  });

  it('404 shows an error state', async () => {
    server.use(
      http.get('/api/v1/homework/:id', () =>
        HttpResponse.json(apiErrorBody(404, 'Not found', '/api/v1/homework/missing'), {
          status: 404,
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/missing'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('Homework not found.')).toBeTruthy();
  });

  it('assign dialog submits and shows a confirmation', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-1', section_name: 'A', class: klass });
    let assignBody: Record<string, unknown> | undefined;

    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
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
    await user.click(screen.getByLabelText('Section'));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(assignBody).toBeDefined());
    expect(assignBody?.section_id).toBe(section.id);
    expect(await screen.findByRole('status')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('there is no Reassign button', async () => {
    server.use(http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)));

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/hw-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Algebra worksheet' });
    expect(screen.queryByRole('button', { name: /reassign/i })).toBeNull();
  });
});
