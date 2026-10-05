import { toast } from '@biddaloy/ui/components';
import type { SectionTeacherAssignment } from '@biddaloy/ui/hooks';
import {
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  teacherFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [29.0] The teaching-assignments bulk view — one card per section of the
 * selected class, against the real route tree. `role: 'ADMIN'` throughout
 * since the route is gated on `CLASS_MANAGE`.
 */
const assignment = (
  id: string,
  section: { id: string; section_name: string },
  type: SectionTeacherAssignment['assignment_type'],
  name: string,
): SectionTeacherAssignment => ({
  id,
  teacher_id: `teacher-${id}`,
  employee_id: `E-${id}`,
  full_name: name,
  section_id: section.id,
  section_name: section.section_name,
  subject_id: null,
  subject_name: null,
  assignment_type: type,
});

const paged = <T,>(data: T[]) => ({ data, total: data.length, page: 1, limit: 100, totalPages: 1 });

function render(path = '/staff/teaching-assignments') {
  return renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/staff/teaching-assignments', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('opens on the first class with one card per section, each with its own Add teacher', async () => {
    const klass = classFactory({ id: 'class-a', name: 'Class 6' });
    const sectionA = classSectionFactory({
      id: 'section-a',
      class_id: klass.id,
      class: klass,
      section_name: 'A',
    });
    const sectionB = classSectionFactory({
      id: 'section-b',
      class_id: klass.id,
      class: klass,
      section_name: 'B',
    });
    server.use(
      http.get('/api/v1/classes', () => HttpResponse.json(paged([klass]))),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([sectionA, sectionB])),
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', ({ params }) =>
        HttpResponse.json(
          params.sectionId === sectionA.id
            ? [
                // Given in reverse order on purpose.
                assignment('3', sectionA, 'SUBJECT_TEACHER', 'Subject T'),
                assignment('2', sectionA, 'ASSISTANT_CLASS_TEACHER', 'Assistant T'),
                assignment('1', sectionA, 'CLASS_TEACHER', 'Class T'),
              ]
            : [],
        ),
      ),
    );

    render();

    expect(await screen.findByRole('heading', { name: 'Section A' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Section B' })).toBeTruthy();
    // Labelled class picker, no section picker.
    expect(screen.getByRole('combobox', { name: 'Class' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Section' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Add teacher' })).toHaveLength(2);
    // Empty section: its own message, no pager.
    expect(await screen.findByText('No one yet')).toBeTruthy();

    const cardA = screen.getByRole('heading', { name: 'Section A' }).closest('section')!;
    const rows = within(within(cardA).getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent ?? '');
    expect(rows[0]).toContain('Class teacher');
    expect(rows[1]).toContain('Assistant class teacher');
    expect(rows[2]).toContain('Subject teacher');
    expect(within(cardA).queryByRole('button', { name: /next/i })).toBeNull();
  });

  it('class picker switches the cards to the selected class', async () => {
    const classA = classFactory({ id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', name: 'Class 6' });
    const classB = classFactory({ id: '4fa85f64-5717-4562-b3fc-2c963f66afa6', name: 'Class 7' });
    const sectionA = classSectionFactory({ id: 'section-a', class_id: classA.id, class: classA });
    const sectionB = classSectionFactory({ id: 'section-b', class_id: classB.id, class: classB });
    server.use(
      http.get('/api/v1/classes', () => HttpResponse.json(paged([classA, classB]))),
      http.get('/api/v1/classes/:classId/sections', ({ params }) =>
        HttpResponse.json(params.classId === classA.id ? [sectionA] : [sectionB]),
      ),
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', ({ params }) =>
        HttpResponse.json(
          params.sectionId === sectionA.id
            ? [assignment('a', sectionA, 'CLASS_TEACHER', 'Teacher A')]
            : [assignment('b', sectionB, 'CLASS_TEACHER', 'Teacher B')],
        ),
      ),
    );

    render();

    await screen.findByText('Teacher A');
    expect(screen.queryByText('Teacher B')).toBeNull();

    const user = userEvent.setup();
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
    // own retry click is an implementation detail.
    let broken = true;
    server.use(
      http.get('/api/v1/classes', () => {
        if (broken) {
          // 4xx, not 5xx — `shouldRetryQuery` retries a 5xx with backoff.
          return HttpResponse.json({ statusCode: 400, message: 'boom' }, { status: 400 });
        }
        return HttpResponse.json(paged([klass]));
      }),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([])),
    );

    render();

    await screen.findByRole('heading', { name: 'Teacher assignments' });
    const retryButton = await screen.findByRole('button', { name: 'Retry' });

    broken = false;
    const user = userEvent.setup();
    await user.click(retryButton);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
    expect(await screen.findByRole('combobox', { name: 'Class' })).toBeTruthy();
  });

  it('shows an empty state when the school has no classes', async () => {
    server.use(http.get('/api/v1/classes', () => HttpResponse.json(paged([]))));

    render();

    expect(await screen.findByText('No classes yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add class' })).toBeTruthy();
  });

  it('removes a teacher through the confirm dialog', async () => {
    const klass = classFactory({ id: 'class-a', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-a', class_id: klass.id, class: klass });
    let assignments: SectionTeacherAssignment[] = [
      assignment('a', section, 'CLASS_TEACHER', 'Teacher A'),
    ];
    let deleted: Record<string, unknown> = {};

    server.use(
      http.get('/api/v1/classes', () => HttpResponse.json(paged([klass]))),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', () =>
        HttpResponse.json(assignments),
      ),
      http.delete(
        '/api/v1/classes/:classId/sections/:sectionId/teachers/:assignmentId',
        ({ params }) => {
          deleted = params;
          assignments = [];
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );

    render();

    await screen.findByText('Teacher A');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove from section' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove this teacher?')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByText('Teacher A')).toBeNull());
    expect(deleted).toMatchObject({
      classId: 'class-a',
      sectionId: 'section-a',
      assignmentId: 'a',
    });
  });

  it('warns that the current class teacher is replaced when assigning from a card', async () => {
    const klass = classFactory({ id: 'class-a', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-a', class_id: klass.id, class: klass });
    const newTeacher = teacherFactory({ id: 'teacher-new', employee_id: 'EMP-NEW' });
    server.use(
      http.get('/api/v1/classes', () => HttpResponse.json(paged([klass]))),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', () =>
        HttpResponse.json([assignment('a', section, 'CLASS_TEACHER', 'Rahim Uddin')]),
      ),
      http.get('/api/v1/teachers', () => HttpResponse.json(paged([newTeacher]))),
      http.get('/api/v1/subjects', () => HttpResponse.json(paged([]))),
    );

    render();

    await screen.findByText('Rahim Uddin');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add teacher' }));
    const dialog = await screen.findByRole('dialog', { name: 'Assign teacher' });
    const combo = await within(dialog).findByRole('combobox', { name: 'Teacher' });
    combo.focus();
    await waitFor(() => expect(combo.getAttribute('aria-expanded')).toBe('true'));
    await user.click(await screen.findByRole('option', { name: /EMP-NEW/ }));

    expect(
      await within(dialog).findByText('Rahim Uddin will be replaced as class teacher'),
    ).toBeTruthy();
  });

  it('closes the confirm and shows a translated toast when removing fails', async () => {
    const klass = classFactory({ id: 'class-a', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-a', class_id: klass.id, class: klass });
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    server.use(
      http.get('/api/v1/classes', () => HttpResponse.json(paged([klass]))),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', () =>
        HttpResponse.json([assignment('a', section, 'CLASS_TEACHER', 'Teacher A')]),
      ),
      http.delete('/api/v1/classes/:classId/sections/:sectionId/teachers/:assignmentId', () =>
        HttpResponse.json({ statusCode: 400, message: 'raw server text' }, { status: 400 }),
      ),
    );

    render();
    await screen.findByText('Teacher A');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove from section' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(toastSpy).toHaveBeenCalledWith("Couldn't remove. Try again.");
    expect(screen.queryByText(/raw server text/)).toBeNull();
    toastSpy.mockRestore();
  });
});
