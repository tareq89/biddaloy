import {
  cleanupTestState,
  classFactory,
  renderWithRouter,
  server,
  teacherFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

function paginated<T>(data: T[]) {
  return { data, total: data.length, page: 1, limit: 10, totalPages: 1 };
}

/**
 * [#1026] Staff detail's Teaching assignments tab — the teacher-centric
 * mirror of `classes/-detail/teachers-tab.test.tsx`. Deep-linked via
 * `?tab=teachingAssignments`.
 */
describe('staff/$userId Teaching assignments tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders assignment rows for the teacher', async () => {
    const teacher = teacherFactory({ id: 'teacher-1', employee_id: 'EMP-00001' });
    const user = teacher.user;

    server.use(
      http.get('/api/v1/users/:id', () => HttpResponse.json(user)),
      http.get('/api/v1/teachers', () => HttpResponse.json(paginated([teacher]))),
      http.get('/api/v1/teachers/:teacherId/assignments', () =>
        HttpResponse.json([
          {
            id: 'assignment-1',
            teacher_id: teacher.id,
            employee_id: teacher.employee_id,
            full_name: user.full_name,
            section_id: 'section-1',
            section_name: 'A',
            class_id: 'class-1',
            class_name: 'Class 6',
            subject_id: null,
            subject_name: null,
          },
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [`/staff/${user.id}?tab=teachingAssignments`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: 'Teaching assignments', selected: true }),
      ).toBeTruthy(),
    );
    await screen.findByText('Class 6');
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('assign opens the dialog with the teacher prefilled', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const teacher = teacherFactory({ id: 'teacher-1', employee_id: 'EMP-00001' });
    const user = teacher.user;
    let assigned = false;

    server.use(
      http.get('/api/v1/users/:id', () => HttpResponse.json(user)),
      http.get('/api/v1/teachers', () => HttpResponse.json(paginated([teacher]))),
      http.get('/api/v1/teachers/:teacherId/assignments', () =>
        HttpResponse.json(
          assigned
            ? [
                {
                  id: 'assignment-1',
                  teacher_id: teacher.id,
                  employee_id: teacher.employee_id,
                  full_name: user.full_name,
                  section_id: 'section-1',
                  section_name: 'A',
                  class_id: klass.id,
                  class_name: klass.name,
                  subject_id: null,
                  subject_name: null,
                },
              ]
            : [],
        ),
      ),
      http.get('/api/v1/classes', () => HttpResponse.json(paginated([klass]))),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([{ id: 'section-1', section_name: 'A', enrolled_count: 0 }]),
      ),
      http.get('/api/v1/subjects', () => HttpResponse.json(paginated([]))),
      http.post('/api/v1/classes/:classId/sections/:sectionId/teachers', () => {
        assigned = true;
        return HttpResponse.json(
          { id: 'assignment-1', teacher_id: teacher.id, section_id: 'section-1' },
          { status: 201 },
        );
      }),
    );

    const testUser = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: [`/staff/${user.id}?tab=teachingAssignments`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('No assignments yet');
    await testUser.click(screen.getByRole('button', { name: 'Assign' }));

    const dialog = await screen.findByRole('dialog', { name: 'Assign teacher' });
    // Teacher-centric mode: no teacher picker rendered, class/section pickers are.
    expect(within(dialog).queryByRole('combobox', { name: 'Teacher' })).toBeNull();
    const classCombo = within(dialog).getByRole('combobox', { name: 'Class' });
    classCombo.focus();
    await waitFor(() => expect(classCombo.getAttribute('aria-expanded')).toBe('true'));
    await testUser.click(await screen.findByRole('option', { name: klass.name }));

    const sectionCombo = within(dialog).getByRole('combobox', { name: 'Section' });
    sectionCombo.focus();
    await waitFor(() => expect(sectionCombo.getAttribute('aria-expanded')).toBe('true'));
    await testUser.click(await screen.findByRole('option', { name: 'A' }));

    await testUser.click(within(dialog).getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await screen.findByText('Class 6');
  });

  it('removes an assignment', async () => {
    const teacher = teacherFactory({ id: 'teacher-1', employee_id: 'EMP-00001' });
    const user = teacher.user;
    let removed = false;

    server.use(
      http.get('/api/v1/users/:id', () => HttpResponse.json(user)),
      http.get('/api/v1/teachers', () => HttpResponse.json(paginated([teacher]))),
      http.get('/api/v1/teachers/:teacherId/assignments', () =>
        HttpResponse.json(
          removed
            ? []
            : [
                {
                  id: 'assignment-1',
                  teacher_id: teacher.id,
                  employee_id: teacher.employee_id,
                  full_name: user.full_name,
                  section_id: 'section-1',
                  section_name: 'A',
                  class_id: 'class-1',
                  class_name: 'Class 6',
                  subject_id: null,
                  subject_name: null,
                },
              ],
        ),
      ),
      http.delete('/api/v1/classes/:classId/sections/:sectionId/teachers/:assignmentId', () => {
        removed = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const testUser = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: [`/staff/${user.id}?tab=teachingAssignments`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Class 6');
    await testUser.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByText('Class 6')).toBeNull());
    await screen.findByText('No assignments yet');
  });
});
