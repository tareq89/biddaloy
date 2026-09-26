import type { SectionTeacherAssignment } from '@biddaloy/ui/hooks';
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

import { routeTree } from '../../../routeTree.gen';

/**
 * [29.0] The teaching-assignments bulk view — real `ListShell`/`DataTable`
 * against the real route tree, same reasoning `classes/index.test.tsx`'s
 * own header comment. `role: 'ADMIN'` throughout since the route is gated
 * on `CLASS_MANAGE`.
 */
describe('/staff/teaching-assignments', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('class filter narrows the table to the selected class', async () => {
    const classA = classFactory({ id: 'class-a', name: 'Class 6' });
    const classB = classFactory({ id: 'class-b', name: 'Class 7' });
    const sectionA = classSectionFactory({ id: 'section-a', class_id: classA.id, class: classA });
    const sectionB = classSectionFactory({ id: 'section-b', class_id: classB.id, class: classB });
    const assignmentA: SectionTeacherAssignment = {
      id: 'assign-a',
      teacher_id: 'teacher-a',
      employee_id: 'E-1',
      full_name: 'Teacher A',
      section_id: sectionA.id,
      section_name: sectionA.section_name,
      subject_id: null,
      subject_name: null,
    };
    const assignmentB: SectionTeacherAssignment = {
      id: 'assign-b',
      teacher_id: 'teacher-b',
      employee_id: 'E-2',
      full_name: 'Teacher B',
      section_id: sectionB.id,
      section_name: sectionB.section_name,
      subject_id: null,
      subject_name: null,
    };

    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({
          data: [classA, classB],
          total: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes/:classId/sections', ({ params }) =>
        HttpResponse.json(params.classId === classA.id ? [sectionA] : [sectionB]),
      ),
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', ({ params }) =>
        HttpResponse.json(params.sectionId === sectionA.id ? [assignmentA] : [assignmentB]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff/teaching-assignments'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Teaching assignments' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 6' }));

    await screen.findByText('Teacher A');
    expect(screen.queryByText('Teacher B')).toBeNull();

    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 7' }));

    await screen.findByText('Teacher B');
    expect(screen.queryByText('Teacher A')).toBeNull();
  });

  it('shows a retry action when the class list fails to load', async () => {
    const klass = classFactory({ id: 'class-a', name: 'Class 6' });
    // An explicit "unlock" flag, not a call counter — the route loader's
    // `ensureQueryData` and the component's own `useAllClasses()` both
    // request this query, and how many attempts fire before the user's
    // own retry click is an implementation detail, not something this
    // test should have to predict.
    let broken = true;
    server.use(
      http.get('/api/v1/classes', () => {
        if (broken) {
          // 4xx, not 5xx — `shouldRetryQuery` retries a 5xx twice with
          // backoff before `isError` flips, which would make this test
          // either flaky or slow. A 4xx fails immediately.
          return HttpResponse.json({ statusCode: 400, message: 'boom' }, { status: 400 });
        }
        return HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff/teaching-assignments'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Teaching assignments' });
    const retryButton = await screen.findByRole('button', { name: 'Retry' });

    broken = false;
    const user = userEvent.setup();
    await user.click(retryButton);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 6' }));
  });

  it('unassigns a teacher from a row', async () => {
    const klass = classFactory({ id: 'class-a', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-a', class_id: klass.id, class: klass });
    let assignments: SectionTeacherAssignment[] = [
      {
        id: 'assign-a',
        teacher_id: 'teacher-a',
        employee_id: 'E-1',
        full_name: 'Teacher A',
        section_id: section.id,
        section_name: section.section_name,
        subject_id: null,
        subject_name: null,
      },
    ];

    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', () =>
        HttpResponse.json(assignments),
      ),
      http.delete('/api/v1/classes/:classId/sections/:sectionId/teachers/:assignmentId', () => {
        assignments = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff/teaching-assignments'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Teaching assignments' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 6' }));

    await screen.findByText('Teacher A');
    await user.click(screen.getByRole('button', { name: 'Unassign' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Unassign' }));

    await waitFor(() => expect(screen.queryByText('Teacher A')).toBeNull());
  });
});
