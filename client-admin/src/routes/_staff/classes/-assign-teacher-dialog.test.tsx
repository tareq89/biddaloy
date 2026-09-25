/**
 * [29.0] Rendered directly, not through a routed page — same precedent
 * `-schedule-form-dialog.test.tsx` documents for a modal with no route of
 * its own to mount through.
 */
import {
  apiErrorBody,
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithProviders,
  server,
  subjectFactory,
  teacherFactory,
  userEvent,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssignTeacherDialog } from './-assign-teacher-dialog';

const TEACHER = teacherFactory({ id: 'teacher-1', employee_id: 'EMP-00001' });
const SUBJECT = subjectFactory({ id: 'subject-1', name_en: 'Mathematics', code: 'MATH' });
const CLASS = classFactory({ id: 'class-1', name: 'Class One' });
const SECTION = classSectionFactory({ id: 'section-1', section_name: 'Section A' });

function paginated<T>(rows: T[]) {
  return { data: rows, total: rows.length, page: 1, limit: 100, totalPages: 1 };
}

function referenceHandlers() {
  return [
    http.get('/api/v1/teachers', () => HttpResponse.json(paginated([TEACHER]))),
    http.get('/api/v1/subjects', () => HttpResponse.json(paginated([SUBJECT]))),
    http.get('/api/v1/classes', () => HttpResponse.json(paginated([CLASS]))),
    http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([SECTION])),
  ];
}

async function renderDialog(props: Partial<React.ComponentProps<typeof AssignTeacherDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onAssigned = vi.fn();
  const view = renderWithProviders(
    <AssignTeacherDialog
      open
      onOpenChange={onOpenChange}
      classId="class-1"
      sectionId="section-1"
      onAssigned={onAssigned}
      {...props}
    />,
    { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
  );
  await view.localeReady;
  return { ...view, onOpenChange, onAssigned };
}

describe('AssignTeacherDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('submits a class-teacher assignment with no subject_id', async () => {
    server.use(...referenceHandlers());
    let submittedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/classes/:classId/sections/:sectionId/teachers', async ({ request }) => {
        submittedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { id: 'assignment-1', teacher_id: 'teacher-1', section_id: 'section-1' },
          { status: 201 },
        );
      }),
    );

    const { onAssigned } = await renderDialog();
    const user = userEvent.setup();

    const combo = await screen.findByRole('combobox', { name: 'Teacher' });
    combo.focus();
    await waitFor(() => expect(combo.getAttribute('aria-expanded')).toBe('true'));
    await user.click(await screen.findByRole('option', { name: /EMP-00001/ }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(onAssigned).toHaveBeenCalled());
    expect(submittedBody).toEqual({ teacher_id: 'teacher-1' });
  });

  it('submits a subject-teacher assignment with the chosen subject_id', async () => {
    server.use(...referenceHandlers());
    let submittedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/classes/:classId/sections/:sectionId/teachers', async ({ request }) => {
        submittedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { id: 'assignment-1', teacher_id: 'teacher-1', section_id: 'section-1' },
          { status: 201 },
        );
      }),
    );

    const { onAssigned } = await renderDialog();
    const user = userEvent.setup();

    const teacherCombo = await screen.findByRole('combobox', { name: 'Teacher' });
    teacherCombo.focus();
    await waitFor(() => expect(teacherCombo.getAttribute('aria-expanded')).toBe('true'));
    await user.click(await screen.findByRole('option', { name: /EMP-00001/ }));
    await user.click(screen.getByRole('radio', { name: 'Subject teacher' }));
    const subjectCombo = await screen.findByRole('combobox', { name: 'Subject' });
    subjectCombo.focus();
    await waitFor(() => expect(subjectCombo.getAttribute('aria-expanded')).toBe('true'));
    await user.click(await screen.findByRole('option', { name: /MATH/ }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(onAssigned).toHaveBeenCalled());
    expect(submittedBody).toEqual({ teacher_id: 'teacher-1', subject_id: 'subject-1' });
  });

  it('shows the 409 duplicate-assignment error inline, not as a toast', async () => {
    server.use(...referenceHandlers());
    server.use(
      http.post('/api/v1/classes/:classId/sections/:sectionId/teachers', () =>
        HttpResponse.json(
          apiErrorBody(
            409,
            'Teacher already assigned to this section for this subject',
            '/api/v1/classes/class-1/sections/section-1/teachers',
          ),
          { status: 409 },
        ),
      ),
    );

    const { onAssigned } = await renderDialog();
    const user = userEvent.setup();

    const combo = await screen.findByRole('combobox', { name: 'Teacher' });
    combo.focus();
    await waitFor(() => expect(combo.getAttribute('aria-expanded')).toBe('true'));
    await user.click(await screen.findByRole('option', { name: /EMP-00001/ }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    expect(
      await screen.findByText('This teacher is already assigned to this section for this subject'),
    ).toBeTruthy();
    expect(onAssigned).not.toHaveBeenCalled();
  });

  // [#1026 gap fix] Teacher-centric mode: no classId/sectionId props ->
  // an inline class->section picker, and a teacherId prop prefills/hides
  // the teacher picker.
  describe('teacher-centric mode (no classId/sectionId)', () => {
    it('hides the teacher picker when teacherId is given, and posts to the picked class/section', async () => {
      server.use(...referenceHandlers());
      let capturedUrl: string | undefined;
      let submittedBody: Record<string, unknown> | undefined;
      server.use(
        http.post(
          '/api/v1/classes/:classId/sections/:sectionId/teachers',
          async ({ request, params }) => {
            capturedUrl = `${params.classId}/${params.sectionId}`;
            submittedBody = (await request.json()) as Record<string, unknown>;
            return HttpResponse.json(
              { id: 'assignment-1', teacher_id: 'teacher-1', section_id: 'section-1' },
              { status: 201 },
            );
          },
        ),
      );

      const { onAssigned } = await renderDialog({
        classId: undefined,
        sectionId: undefined,
        teacherId: 'teacher-1',
      });
      const user = userEvent.setup();

      // No teacher combobox rendered — it's prefilled/hidden.
      expect(screen.queryByRole('combobox', { name: 'Teacher' })).toBeNull();

      const classCombo = await screen.findByRole('combobox', { name: 'Class' });
      classCombo.focus();
      await waitFor(() => expect(classCombo.getAttribute('aria-expanded')).toBe('true'));
      await user.click(await screen.findByRole('option', { name: 'Class One' }));

      const sectionCombo = await screen.findByRole('combobox', { name: 'Section' });
      sectionCombo.focus();
      await waitFor(() => expect(sectionCombo.getAttribute('aria-expanded')).toBe('true'));
      await user.click(await screen.findByRole('option', { name: 'Section A' }));

      await user.click(screen.getByRole('button', { name: 'Assign' }));

      await waitFor(() => expect(onAssigned).toHaveBeenCalled());
      expect(capturedUrl).toBe('class-1/section-1');
      expect(submittedBody).toEqual({ teacher_id: 'teacher-1' });
    });

    it('shows a class-required validation error when no class is picked', async () => {
      server.use(...referenceHandlers());

      await renderDialog({ classId: undefined, sectionId: undefined, teacherId: 'teacher-1' });
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Assign' }));

      expect(await screen.findByText('Class is required')).toBeTruthy();
    });
  });
});
