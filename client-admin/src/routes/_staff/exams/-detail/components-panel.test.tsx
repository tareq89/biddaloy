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

/** [19.6.1] / [31.4.exams-2b] Marks-breakdown tab — attendance-kind disabling (D11),
 * delete confirm, the running total, and the copy tool's `?copy=1` page (D9). */
describe('exams/$examId Marks breakdown tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const klass = classFactory({ id: 'class-1' });
  const exam = examFactory({ id: 'exam-1', class: klass, class_id: klass.id });
  const math = subjectFactory({ id: 'subject-math', name_en: 'Mathematics' });
  const english = subjectFactory({ id: 'subject-eng', name_en: 'English' });
  const offering = (subject: typeof math) =>
    classSubjectFactory({
      class: klass,
      class_id: klass.id,
      subject,
      subject_id: subject.id,
      academic_year: exam.academic_year,
      academic_year_id: exam.academic_year_id,
    });

  function mockTab(options: {
    components?: ReturnType<typeof examComponentFactory>[];
    subjects?: (typeof math)[];
    post?: () => Response | Promise<Response>;
  }) {
    const events = { deletes: [] as string[], posts: [] as unknown[] };
    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(exam)),
      http.get('/api/v1/exams/:examId/marks/progress', () =>
        HttpResponse.json({ counts: { DRAFT: 0, SUBMITTED: 0 }, outstanding: [] }),
      ),
      http.get('/api/v1/classes/:classId/subjects', () =>
        HttpResponse.json((options.subjects ?? [math]).map(offering)),
      ),
      http.get('/api/v1/exams/:examId/components', () =>
        HttpResponse.json(options.components ?? []),
      ),
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.delete('/api/v1/exams/:examId/components/:id', ({ params }) => {
        events.deletes.push(params.id as string);
        return new HttpResponse(null, { status: 204 });
      }),
      http.post('/api/v1/exams/:examId/components', async ({ request }) => {
        events.posts.push(await request.json());
        return (
          options.post?.() ??
          HttpResponse.json(examComponentFactory({ exam_id: exam.id }), { status: 201 })
        );
      }),
    );
    return events;
  }

  function renderTab(search = '?tab=setup') {
    return renderWithRouter(routeTree, {
      initialEntries: [`/exams/exam-1${search}`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
  }

  it('hides the marks field once ATTENDANCE is chosen as the kind', async () => {
    const user = userEvent.setup();
    mockTab({});
    renderTab();

    await screen.findByText('No parts for this subject yet');
    await screen.findByLabelText('Full marks');

    await user.click(screen.getByLabelText('Kind'));
    await user.click(await screen.findByRole('option', { name: 'Attendance' }));

    expect(screen.queryByLabelText('Full marks')).toBeNull();
    expect(screen.queryByLabelText('Pass marks')).toBeNull();
    await screen.findByText(
      "Attendance parts are computed automatically — marks aren't entered for them.",
    );
  });

  it('shows the running full-marks total (derived parts excluded) and no sequence column', async () => {
    mockTab({
      components: [
        examComponentFactory({
          exam_id: exam.id,
          subject_id: math.id,
          name: 'Written',
          full_marks: '70',
          sequence: 1,
          source: 'MANUAL',
        }),
        examComponentFactory({
          exam_id: exam.id,
          subject_id: math.id,
          name: 'MCQ',
          full_marks: '30',
          sequence: 2,
          source: 'MANUAL',
        }),
        examComponentFactory({
          exam_id: exam.id,
          subject_id: math.id,
          name: 'Presence',
          kind: 'ATTENDANCE',
          full_marks: '100',
          sequence: 3,
          source: 'DERIVED',
        }),
      ],
    });
    renderTab();

    // Bangla numerals are the default tenant region.
    await screen.findByText('3 parts · full marks ১০০');
    expect(screen.queryByRole('columnheader', { name: 'Sequence' })).toBeNull();
    expect(screen.getByText('Derived')).toBeTruthy();
  });

  it('asks before deleting a part and only then calls the API', async () => {
    const user = userEvent.setup();
    const events = mockTab({
      components: [
        examComponentFactory({ id: 'comp-1', exam_id: exam.id, subject_id: math.id, name: 'Written' }),
      ],
    });
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Delete this part?')).toBeTruthy();
    expect(events.deletes).toEqual([]);

    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(events.deletes).toEqual(['comp-1']));
  });

  it('a failed add shows the translated message, never the server text', async () => {
    const user = userEvent.setup();
    mockTab({ post: () => HttpResponse.json({ message: 'db exploded' }, { status: 500 }) });
    renderTab();

    await user.type(await screen.findByLabelText('Name'), 'Written');
    await user.type(screen.getByLabelText('Full marks'), '70');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Couldn't save the part.");
    expect(screen.queryByText(/db exploded/)).toBeNull();
  });

  it('the copy button opens the full-page copy tool via ?copy=1', async () => {
    const user = userEvent.setup();
    mockTab({ subjects: [math, english] });
    const view = renderTab();

    await user.click(await screen.findByRole('button', { name: 'Copy from elsewhere' }));
    await screen.findByRole('heading', { name: 'Copy parts' });
    expect(view.router.state.location.search).toMatchObject({ copy: '1' });
  });

  it('the copy tool shows what will be created/skipped before the user confirms', async () => {
    const user = userEvent.setup();
    const mathComponent = examComponentFactory({
      exam,
      exam_id: exam.id,
      subject: math,
      subject_id: math.id,
      name: 'Written',
    });
    let copyCalled = false;
    mockTab({ subjects: [math, english], components: [mathComponent] });
    server.use(
      http.post('/api/v1/exams/:examId/components/copy', () => {
        copyCalled = true;
        return HttpResponse.json(
          { copied: [{ subject_id: english.id, name: 'Written' }], skipped: [] },
          { status: 201 },
        );
      }),
    );
    renderTab('?tab=setup&copy=1');

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText('Subject'));
    await user.click(await screen.findByRole('option', { name: 'Mathematics' }));
    await user.click(within(dialog).getByLabelText('English'));

    await within(dialog).findByText('Preview');
    await within(dialog).findByText('1 to create: Written');
    expect(copyCalled).toBe(false);

    await user.click(within(dialog).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(copyCalled).toBe(true));
  });
});
