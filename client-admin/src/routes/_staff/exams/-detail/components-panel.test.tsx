import {
  classFactory,
  classSubjectFactory,
  cleanupTestState,
  examComponentFactory,
  examFactory,
  renderWithRouter,
  server,
  subjectFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [19.6.1] Setup tab — attendance-kind marks-field disabling (D11) and
 * the copy dialog's preview-before-confirm (D9). */
describe('exams/$examId Setup tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('hides the marks field once ATTENDANCE is chosen as the kind', async () => {
    const user = userEvent.setup();
    const klass = classFactory({ id: 'class-1' });
    const exam = examFactory({ id: 'exam-1', class: klass, class_id: klass.id });
    const math = subjectFactory({ id: 'subject-math', name_en: 'Mathematics' });
    const mathOffering = classSubjectFactory({
      class: klass,
      class_id: klass.id,
      subject: math,
      subject_id: math.id,
      academic_year: exam.academic_year,
      academic_year_id: exam.academic_year_id,
    });

    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(exam)),
      http.get('/api/v1/exams/:examId/marks/progress', () =>
        HttpResponse.json({ counts: { DRAFT: 0, SUBMITTED: 0 }, outstanding: [] }),
      ),
      http.get('/api/v1/classes/:classId/subjects', () => HttpResponse.json([mathOffering])),
      http.get('/api/v1/exams/:examId/components', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=setup'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('No components yet.');
    await screen.findByLabelText('Full marks');

    await user.click(screen.getByLabelText('Kind'));
    await user.click(await screen.findByRole('option', { name: 'Attendance' }));

    expect(screen.queryByLabelText('Full marks')).toBeNull();
    expect(screen.queryByLabelText('Pass marks')).toBeNull();
    await screen.findByText(
      "Attendance components are computed automatically — marks aren't entered for them.",
    );
  });

  it('the copy dialog shows what will be created/skipped before the user confirms', async () => {
    const user = userEvent.setup();
    const klass = classFactory({ id: 'class-1' });
    const exam = examFactory({ id: 'exam-1', class: klass, class_id: klass.id });
    const math = subjectFactory({ id: 'subject-math', name_en: 'Mathematics' });
    const english = subjectFactory({ id: 'subject-eng', name_en: 'English' });
    const mathOffering = classSubjectFactory({
      class: klass,
      class_id: klass.id,
      subject: math,
      subject_id: math.id,
      academic_year: exam.academic_year,
      academic_year_id: exam.academic_year_id,
    });
    const englishOffering = classSubjectFactory({
      class: klass,
      class_id: klass.id,
      subject: english,
      subject_id: english.id,
      academic_year: exam.academic_year,
      academic_year_id: exam.academic_year_id,
    });
    const mathComponent = examComponentFactory({
      exam,
      exam_id: exam.id,
      subject: math,
      subject_id: math.id,
      name: 'Written',
    });
    let copyCalled = false;

    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(exam)),
      http.get('/api/v1/exams/:examId/marks/progress', () =>
        HttpResponse.json({ counts: { DRAFT: 0, SUBMITTED: 0 }, outstanding: [] }),
      ),
      http.get('/api/v1/classes/:classId/subjects', () =>
        HttpResponse.json([mathOffering, englishOffering]),
      ),
      http.get('/api/v1/exams/:examId/components', ({ request }) => {
        const url = new URL(request.url);
        const subjectId = url.searchParams.get('subject_id');
        if (subjectId === math.id) return HttpResponse.json([mathComponent]);
        if (subjectId === null) return HttpResponse.json([mathComponent]);
        return HttpResponse.json([]);
      }),
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.post('/api/v1/exams/:examId/components/copy', () => {
        copyCalled = true;
        return HttpResponse.json(
          { copied: [{ subject_id: english.id, name: 'Written' }], skipped: [] },
          { status: 201 },
        );
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=setup'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await user.click(await screen.findByRole('button', { name: 'Copy components…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText('Subject'));
    await user.click(await screen.findByRole('option', { name: 'Mathematics' }));
    await user.click(within(dialog).getByLabelText('English'));

    // Preview renders before any confirm click.
    await within(dialog).findByText('Preview');
    await within(dialog).findByText('1 to create: Written');
    expect(copyCalled).toBe(false);

    await user.click(within(dialog).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(copyCalled).toBe(true));
  });
});
