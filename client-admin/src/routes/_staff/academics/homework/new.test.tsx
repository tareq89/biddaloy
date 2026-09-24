import { HomeworkGradingMode } from '@biddaloy/shared';
import {
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  studentFactory,
  subjectFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

describe('/academics/homework/new', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function setUpPickers() {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const subject = subjectFactory({ id: 'subject-1', name_en: 'Mathematics' });
    const section = classSectionFactory({ id: 'section-1', section_name: 'A', class: klass });
    const student = studentFactory({ id: 'student-1', full_name: 'Karim Ahmed' });

    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/subjects', () =>
        HttpResponse.json([{ ...subject, subject, subject_id: subject.id, class: klass }]),
      ),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    return { klass, subject, section, student };
  }

  async function fillCreateBasics(user: ReturnType<typeof userEvent.setup>, className: string) {
    await user.click(screen.getByLabelText('Class'));
    await user.click(await screen.findByRole('option', { name: className }));
    await user.click(screen.getByLabelText('Subject'));
    await user.click(await screen.findByRole('option', { name: 'Mathematics' }));
    await user.type(screen.getByLabelText('Title'), 'Algebra worksheet');
  }

  it('happy path: section target creates then assigns with section_id only', async () => {
    const { klass, section } = setUpPickers();
    let createCount = 0;
    let assignBody: Record<string, unknown> | undefined;

    server.use(
      http.post('/api/v1/homework', () => {
        createCount += 1;
        return HttpResponse.json(
          {
            id: 'hw-1',
            subject_id: 'subject-1',
            class_id: klass.id,
            title: 'Algebra worksheet',
            description: null,
            grading_mode: HomeworkGradingMode.TICK,
            attachments: [],
            created_at: '2026-09-01T00:00:00.000Z',
          },
          { status: 201 },
        );
      }),
      http.post('/api/v1/homework/:id/assign', async ({ request }) => {
        assignBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          id: 'assignment-1',
          homework_id: 'hw-1',
          section_id: assignBody.section_id ?? null,
          student_id: assignBody.student_id ?? null,
          assigned_date: assignBody.assigned_date,
          due_date: assignBody.due_date,
          status: 'ACTIVE',
        });
      }),
      http.get('/api/v1/homework/:id', () =>
        HttpResponse.json({
          id: 'hw-1',
          subject_id: 'subject-1',
          class_id: klass.id,
          title: 'Algebra worksheet',
          description: null,
          grading_mode: HomeworkGradingMode.TICK,
          attachments: [],
          created_at: '2026-09-01T00:00:00.000Z',
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Create homework' });
    await fillCreateBasics(user, klass.name);
    await user.click(screen.getByLabelText('Section'));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(assignBody).toBeDefined());
    expect(createCount).toBe(1);
    expect(assignBody?.section_id).toBe(section.id);
    expect(assignBody?.student_id).toBeUndefined();
    await screen.findByRole('heading', { name: 'Algebra worksheet' });
  });

  it('student target sends student_id and no section_id', async () => {
    const { klass, section, student } = setUpPickers();
    let assignBody: Record<string, unknown> | undefined;

    server.use(
      http.post('/api/v1/homework', () =>
        HttpResponse.json(
          {
            id: 'hw-1',
            subject_id: 'subject-1',
            class_id: klass.id,
            title: 'Algebra worksheet',
            description: null,
            grading_mode: HomeworkGradingMode.TICK,
            attachments: [],
            created_at: '2026-09-01T00:00:00.000Z',
          },
          { status: 201 },
        ),
      ),
      http.post('/api/v1/homework/:id/assign', async ({ request }) => {
        assignBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          id: 'assignment-1',
          homework_id: 'hw-1',
          section_id: null,
          student_id: assignBody.student_id,
          assigned_date: assignBody.assigned_date,
          due_date: assignBody.due_date,
          status: 'ACTIVE',
        });
      }),
      http.get('/api/v1/homework/:id', () =>
        HttpResponse.json({
          id: 'hw-1',
          subject_id: 'subject-1',
          class_id: klass.id,
          title: 'Algebra worksheet',
          description: null,
          grading_mode: HomeworkGradingMode.TICK,
          attachments: [],
          created_at: '2026-09-01T00:00:00.000Z',
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Create homework' });
    await fillCreateBasics(user, klass.name);
    await user.click(screen.getByLabelText('Section'));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    await user.click(screen.getByLabelText('Assign to: Student'));
    await user.click(screen.getByLabelText('Student'));
    await user.click(await screen.findByRole('option', { name: /Karim Ahmed/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(assignBody).toBeDefined());
    expect(assignBody?.student_id).toBe(student.id);
    expect(assignBody?.section_id).toBeUndefined();
  });

  it('assign 400 after a successful create shows an error and a retry does not re-create', async () => {
    const { klass, section } = setUpPickers();
    let createCount = 0;
    let assignCount = 0;

    server.use(
      http.post('/api/v1/homework', () => {
        createCount += 1;
        return HttpResponse.json(
          {
            id: 'hw-1',
            subject_id: 'subject-1',
            class_id: klass.id,
            title: 'Algebra worksheet',
            description: null,
            grading_mode: HomeworkGradingMode.TICK,
            attachments: [],
            created_at: '2026-09-01T00:00:00.000Z',
          },
          { status: 201 },
        );
      }),
      http.post('/api/v1/homework/:id/assign', () => {
        assignCount += 1;
        return HttpResponse.json({ message: 'Bad request' }, { status: 400 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Create homework' });
    await fillCreateBasics(user, klass.name);
    await user.click(screen.getByLabelText('Section'));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('alert');
    expect(createCount).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(assignCount).toBe(2));
    expect(createCount).toBe(1);
  });

  it('prefills class/section from search params', async () => {
    const { klass, section } = setUpPickers();

    renderWithRouter(routeTree, {
      initialEntries: [`/academics/homework/new?class_id=${klass.id}&section_id=${section.id}`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Create homework' });
    await waitFor(() => within(screen.getByLabelText('Class')).getByText(klass.name));
    await waitFor(() => within(screen.getByLabelText('Section')).getByText(section.section_name));
  });

  it('due date before assigned date shows an inline error and sends no request', async () => {
    const { klass, section } = setUpPickers();
    let assignCount = 0;
    server.use(
      http.post('/api/v1/homework/:id/assign', () => {
        assignCount += 1;
        return HttpResponse.json({});
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Create homework' });
    await fillCreateBasics(user, klass.name);
    await user.click(screen.getByLabelText('Section'));
    await user.click(await screen.findByRole('option', { name: section.section_name }));

    await user.clear(screen.getByLabelText('Due date'));
    await user.type(screen.getByLabelText('Due date'), '2020-01-01');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Due date must be on or after/i)).toBeTruthy();
    expect(assignCount).toBe(0);
  });
});
