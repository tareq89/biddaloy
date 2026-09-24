import { ExamComponentKind } from '@biddaloy/shared';
import {
  cleanupTestState,
  examComponentFactory,
  examFactory,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { CopyComponentsDialog } from './-copy-components-dialog';

const EXAM_ID = 'exam-1';
const OTHER_EXAM_ID = 'exam-0';
const SUBJECTS = [
  { subject_id: 'subject-math', name: 'Mathematics' },
  { subject_id: 'subject-eng', name: 'English' },
];

function component(
  examId: string,
  subjectId: string,
  name: string,
  kind: ExamComponentKind = ExamComponentKind.WRITTEN,
) {
  return examComponentFactory({ exam_id: examId, subject_id: subjectId, name, kind });
}

/** Wires every query the dialog makes. `components` is keyed by
 * `${examId}:${subjectId ?? 'all'}`. */
function mockApi(components: Record<string, ReturnType<typeof component>[]>, copyStatus = 200) {
  const copyBodies: unknown[] = [];
  server.use(
    http.get('/api/v1/exams', () =>
      HttpResponse.json({
        data: [
          examFactory({ id: EXAM_ID, name: 'Final' }),
          examFactory({ id: OTHER_EXAM_ID, name: 'Midterm' }),
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/exams/:examId/components', ({ params, request }) => {
      const subjectId = new URL(request.url).searchParams.get('subject_id') ?? 'all';
      return HttpResponse.json(components[`${params.examId as string}:${subjectId}`] ?? []);
    }),
    http.post('/api/v1/exams/:examId/components/copy', async ({ request }) => {
      copyBodies.push(await request.json());
      return copyStatus === 200
        ? HttpResponse.json({ copied: [], skipped: [] })
        : HttpResponse.json({ message: 'boom' }, { status: copyStatus });
    }),
  );
  return copyBodies;
}

function renderDialog() {
  return renderWithProviders(
    <CopyComponentsDialog
      open
      onOpenChange={() => undefined}
      examId={EXAM_ID}
      classId="class-1"
      subjects={SUBJECTS}
    />,
    { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
  );
}

describe('CopyComponentsDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it("exam mode keeps the source subject selectable as a target — copying Maths from the midterm into this exam's Maths", async () => {
    const copyBodies = mockApi({
      [`${OTHER_EXAM_ID}:subject-math`]: [component(OTHER_EXAM_ID, 'subject-math', 'Written')],
    });
    const { user } = renderDialog();
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByLabelText('The same subject in a different exam'));
    await user.click(within(dialog).getByLabelText('Exam'));
    await user.click(await screen.findByRole('option', { name: 'Midterm' }));
    await user.click(within(dialog).getByLabelText('Subject'));
    await user.click(await screen.findByRole('option', { name: 'Mathematics' }));

    // Mathematics is the source subject *and* still a valid target here.
    await user.click(within(dialog).getByRole('checkbox', { name: 'Mathematics' }));
    await within(dialog).findByText('1 to create: Written');

    await user.click(within(dialog).getByRole('button', { name: 'Copy' }));
    await waitFor(() =>
      expect(copyBodies).toEqual([
        {
          source_exam_id: OTHER_EXAM_ID,
          source_subject_id: 'subject-math',
          target_subject_ids: ['subject-math'],
        },
      ]),
    );
  });

  it('subject mode drops a checked target once it becomes the source', async () => {
    mockApi({
      [`${EXAM_ID}:subject-math`]: [component(EXAM_ID, 'subject-math', 'Written')],
    });
    const { user } = renderDialog();
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('checkbox', { name: 'Mathematics' }));
    await within(dialog).findByText('Preview');

    await user.click(within(dialog).getByLabelText('Subject'));
    await user.click(await screen.findByRole('option', { name: 'Mathematics' }));

    // Mathematics was the only target; becoming the source removes it, so
    // no preview and nothing to confirm.
    await waitFor(() => expect(within(dialog).queryByText('Preview')).toBeNull());
    expect(within(dialog).queryByRole('checkbox', { name: 'Mathematics' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toHaveProperty('disabled', true);
  });

  it('previews name collisions and an existing attendance component as skipped', async () => {
    mockApi({
      [`${EXAM_ID}:subject-math`]: [
        component(EXAM_ID, 'subject-math', 'Written'),
        component(EXAM_ID, 'subject-math', 'Attendance', ExamComponentKind.ATTENDANCE),
      ],
      [`${EXAM_ID}:all`]: [
        component(EXAM_ID, 'subject-eng', 'Written'),
        component(EXAM_ID, 'subject-eng', 'Presence', ExamComponentKind.ATTENDANCE),
      ],
    });
    const { user } = renderDialog();
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByLabelText('Subject'));
    await user.click(await screen.findByRole('option', { name: 'Mathematics' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'English' }));

    await within(dialog).findByText('Written — a component with this name already exists');
    within(dialog).getByText('Attendance — this subject already has an attendance component');
    expect(within(dialog).queryByText(/to create/)).toBeNull();
  });

  it('says there is nothing to copy when the source subject has no components', async () => {
    mockApi({});
    const { user } = renderDialog();
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByLabelText('Subject'));
    await user.click(await screen.findByRole('option', { name: 'Mathematics' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'English' }));

    await within(dialog).findByText('Nothing to copy.');
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toHaveProperty('disabled', true);
  });

  it('shows the error and keeps the dialog open when the copy fails', async () => {
    mockApi({ [`${EXAM_ID}:subject-math`]: [component(EXAM_ID, 'subject-math', 'Written')] }, 500);
    const { user } = renderDialog();
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByLabelText('Subject'));
    await user.click(await screen.findByRole('option', { name: 'Mathematics' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'English' }));
    await within(dialog).findByText('1 to create: Written');
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }));

    await within(dialog).findByRole('alert');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
