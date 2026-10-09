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
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/**
 * [29.0] Class detail page's Teachers tab — deep-linked via
 * `?tab=teachers`, same pattern the other tabs' own specs use. Covers
 * per-section rendering, assign through the shared dialog, and remove.
 */
describe('classes/$classId Teachers tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows an empty message when the class has no sections', async () => {
    const klass = classFactory({ id: 'class-1' });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1?tab=teachers'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('This class has no sections yet');
  });

  it('lists each section with an assign button and its assigned teachers', async () => {
    const klass = classFactory({ id: 'class-1' });
    const section = classSectionFactory({ id: 'section-1', class: klass, section_name: 'A' });
    const teacher = teacherFactory({ id: 'teacher-1', employee_id: 'EMP-00001' });

    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([{ ...section, enrolled_count: 0 }]),
      ),
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', () =>
        HttpResponse.json([
          {
            id: 'assignment-1',
            teacher_id: teacher.id,
            employee_id: teacher.employee_id,
            full_name: teacher.user.full_name,
            section_id: section.id,
            section_name: section.section_name,
            subject_id: null,
            subject_name: null,
            assignment_type: 'CLASS_TEACHER',
          },
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1?tab=teachers'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('A');
    expect(screen.getByRole('button', { name: 'Assign teacher to section A' })).toBeTruthy();
    await screen.findByText(new RegExp(teacher.user.full_name));
  });

  it('assigns a teacher to a section through the shared dialog', async () => {
    const klass = classFactory({ id: 'class-1' });
    const section = classSectionFactory({ id: 'section-1', class: klass, section_name: 'A' });
    const teacher = teacherFactory({ id: 'teacher-1', employee_id: 'EMP-00001' });
    let assigned = false;

    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([{ ...section, enrolled_count: 0 }]),
      ),
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', () =>
        HttpResponse.json(
          assigned
            ? [
                {
                  id: 'assignment-1',
                  teacher_id: teacher.id,
                  employee_id: teacher.employee_id,
                  full_name: teacher.user.full_name,
                  section_id: section.id,
                  section_name: section.section_name,
                  subject_id: null,
                  subject_name: null,
                  assignment_type: 'CLASS_TEACHER',
                },
              ]
            : [],
        ),
      ),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({ data: [teacher], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.post('/api/v1/classes/:classId/sections/:sectionId/teachers', () => {
        assigned = true;
        return HttpResponse.json(
          { id: 'assignment-1', teacher_id: teacher.id, section_id: section.id },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1?tab=teachers'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('No teachers assigned to this section');
    await user.click(screen.getByRole('button', { name: 'Assign teacher to section A' }));

    const dialog = await screen.findByRole('dialog', { name: 'Assign teacher' });
    const combo = within(dialog).getByRole('combobox', { name: 'Teacher' });
    combo.focus();
    await waitFor(() => expect(combo.getAttribute('aria-expanded')).toBe('true'));
    await user.click(await screen.findByRole('option', { name: /EMP-00001/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await screen.findByText(new RegExp(teacher.user.full_name));
  });

  it('removes a teacher assignment from a section', async () => {
    const klass = classFactory({ id: 'class-1' });
    const section = classSectionFactory({ id: 'section-1', class: klass, section_name: 'A' });
    const teacher = teacherFactory({ id: 'teacher-1', employee_id: 'EMP-00001' });
    let removed = false;

    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([{ ...section, enrolled_count: 0 }]),
      ),
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', () =>
        HttpResponse.json(
          removed
            ? []
            : [
                {
                  id: 'assignment-1',
                  teacher_id: teacher.id,
                  employee_id: teacher.employee_id,
                  full_name: teacher.user.full_name,
                  section_id: section.id,
                  section_name: section.section_name,
                  subject_id: null,
                  subject_name: null,
                  assignment_type: 'CLASS_TEACHER',
                },
              ],
        ),
      ),
      http.delete('/api/v1/classes/:classId/sections/:sectionId/teachers/:assignmentId', () => {
        removed = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1?tab=teachers'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const item = (await screen.findByText(teacher.user.full_name)).closest('li') as HTMLElement;
    await user.click(within(item).getByRole('button', { name: 'Remove' }));

    // Cancelling the confirmation removes nothing.
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove this teacher?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(removed).toBe(false);
    expect(screen.getByText(teacher.user.full_name)).toBeTruthy();

    await user.click(within(item).getByRole('button', { name: 'Remove' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }),
    );

    await waitFor(() => expect(screen.queryByText(new RegExp(teacher.user.full_name))).toBeNull());
    await screen.findByText('No teachers assigned to this section');
  });

  it('labels rows from assignment_type, even when subject_name is null', async () => {
    const klass = classFactory({ id: 'class-1' });
    const section = classSectionFactory({ id: 'section-1', class: klass, section_name: 'A' });
    const row = (id: string, name: string, type: string, subject_id: string | null) => ({
      id,
      teacher_id: `t-${id}`,
      employee_id: id,
      full_name: name,
      section_id: section.id,
      section_name: 'A',
      subject_id,
      subject_name: null,
      assignment_type: type,
    });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([{ ...section, enrolled_count: 0 }]),
      ),
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', () =>
        HttpResponse.json([
          row('3', 'Sam Subject', 'SUBJECT_TEACHER', 'subject-gone'),
          row('2', 'Ann Assistant', 'ASSISTANT_CLASS_TEACHER', null),
          row('1', 'Cy Class', 'CLASS_TEACHER', null),
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1?tab=teachers'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Cy Class');
    // Class teacher first, then assistant, then subject teacher; each row
    // carries the role on its own second line.
    const items = screen
      .getAllByRole('listitem')
      .filter((li) => /Cy Class|Ann Assistant|Sam Subject/.test(li.textContent ?? ''));
    expect(items).toHaveLength(3);
    expect(within(items[0] as HTMLElement).getByText('Cy Class')).toBeTruthy();
    expect(within(items[0] as HTMLElement).getByText('Class teacher')).toBeTruthy();
    expect(within(items[1] as HTMLElement).getByText('Ann Assistant')).toBeTruthy();
    expect(within(items[1] as HTMLElement).getByText('Assistant class teacher')).toBeTruthy();
    expect(within(items[2] as HTMLElement).getByText('Sam Subject')).toBeTruthy();
    expect(within(items[2] as HTMLElement).getByText('Subject teacher')).toBeTruthy();
  });
});
