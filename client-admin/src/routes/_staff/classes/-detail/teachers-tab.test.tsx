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

    await screen.findByText(new RegExp(teacher.user.full_name));
    await user.click(
      screen.getByRole('button', { name: `Remove ${teacher.user.full_name} (Class teacher)` }),
    );

    await waitFor(() => expect(screen.queryByText(new RegExp(teacher.user.full_name))).toBeNull());
    await screen.findByText('No teachers assigned to this section');
  });
});
