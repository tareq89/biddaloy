/**
 * [34.4.1], D5 — `RecordDialog`: prefills the milestone and one enrolment
 * when opened from a Students-tab row, supports multi-select, `Enter`
 * submits the form, and calls `onRecorded` (which the caller uses to
 * close and return focus). Same hand-rolled provider stack as
 * `-copy-scale-dialog.test.tsx`.
 */
import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState, createTestQueryClient, server } from '@biddaloy/ui/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecordDialog, type RecordDialogProps } from './-record-dialog';

afterEach(async () => {
  await cleanupTestState();
});

const PROGRAM = {
  id: 'p-1',
  name: 'Reading Club',
  description: null,
  is_active: true,
  show_on_report_card: false,
  milestones: [
    { id: 'm-1', name: 'Read 5 books', description: null, sequence: 1, achievement_count: 0 },
  ],
};

const ENROLLMENTS = [
  {
    id: 'enr-1',
    status: 'ACTIVE',
    started_on: '2026-01-01',
    ended_on: null,
    student: {
      id: 'student-1',
      full_name: 'Anika Rahman',
      roll_number: '12',
      class_name: null,
      section_name: null,
    },
    achieved_count: 0,
    milestone_total: 1,
  },
  {
    id: 'enr-2',
    status: 'ACTIVE',
    started_on: '2026-01-01',
    ended_on: null,
    student: {
      id: 'student-2',
      full_name: 'Bilal Hasan',
      roll_number: '13',
      class_name: null,
      section_name: null,
    },
    achieved_count: 0,
    milestone_total: 1,
  },
];

async function renderDialog(props: Partial<RecordDialogProps> = {}) {
  await i18n.changeLanguage('en');
  setActiveTenant('tenant-1');
  setActiveRole('ADMIN');

  server.use(
    http.get('/api/v1/programs', () => HttpResponse.json([PROGRAM])),
    http.get('/api/v1/programs/:id', () => HttpResponse.json(PROGRAM)),
    http.get('/api/v1/programs/:id/enrollments', () => HttpResponse.json(ENROLLMENTS)),
  );

  const queryClient = createTestQueryClient();
  const onOpenChange = vi.fn();
  const onRecorded = vi.fn();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RecordDialog
          open
          onOpenChange={onOpenChange}
          programId="p-1"
          onRecorded={onRecorded}
          {...props}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );

  return { ...view, onOpenChange, onRecorded };
}

describe('RecordDialog', () => {
  it('prefills the milestone and enrolment from the invoking row', async () => {
    await renderDialog({
      milestoneId: 'm-1',
      enrollmentIdPrefill: 'enr-1',
      studentId: 'student-1',
    });

    await screen.findAllByText('Read 5 books');
    const checkbox = (await screen.findAllByRole('checkbox'))[0]!;
    expect(checkbox.getAttribute('data-state')).toBe('checked');
  });

  it('supports multi-selecting students, submits on Enter, and calls onRecorded', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    server.use(
      http.get('/api/v1/programs/:id', () => HttpResponse.json(PROGRAM)),
      http.get('/api/v1/programs/:id/enrollments', () => HttpResponse.json(ENROLLMENTS)),
      http.post('/api/v1/programs/:id/achievements', async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ upserted: 2 });
      }),
    );

    const { onRecorded } = await renderDialog({
      milestoneId: 'm-1',
      enrollmentIdPrefill: 'enr-1',
      studentId: 'student-1',
    });

    const checkboxes = await screen.findAllByRole('checkbox');
    await user.click(checkboxes[1]!);

    const gradeInput = screen.getByLabelText('Grade');
    await user.click(gradeInput);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
    expect(requestBody).toMatchObject({
      milestone_id: 'm-1',
      enrollment_ids: expect.arrayContaining(['enr-1', 'enr-2']),
    });
  });

  it('shows a Program select when opened with no programId, and clears milestone/enrolments on switch', async () => {
    const user = userEvent.setup();
    await renderDialog({ programId: '' });

    await user.click(screen.getByRole('combobox', { name: /^Program/ }));
    await user.click(await screen.findByRole('option', { name: 'Reading Club' }));

    await screen.findAllByText('Read 5 books');
  });

  it('fills score/grade/remark and shows the error message on a failed submit', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/v1/programs/:id/achievements', () =>
        HttpResponse.json({ message: 'nope' }, { status: 500 }),
      ),
    );

    await renderDialog({
      milestoneId: 'm-1',
      enrollmentIdPrefill: 'enr-1',
      studentId: 'student-1',
    });

    await user.type(screen.getByLabelText('Score'), '85');
    await user.type(screen.getByLabelText('Grade'), 'A');
    await user.type(screen.getByLabelText('Remark'), 'Well done');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText("Couldn't record this achievement");
  });

  it('is a full-page modal with a title, no native date input, and a select-all toggle', async () => {
    const user = userEvent.setup();
    await renderDialog({ milestoneId: 'm-1', enrollmentIdPrefill: 'enr-1' });

    await screen.findByRole('heading', { level: 1, name: 'Record achievement' });
    expect(document.querySelector('input[type="date"]')).toBeNull();
    await screen.findByText('Bilal Hasan');
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeTruthy();
  });

  it('accepts a Bangla-digit score and sends it as a number', async () => {
    const user = userEvent.setup();
    let requestBody: { score?: number } = {};
    server.use(
      http.post('/api/v1/programs/:id/achievements', async ({ request }) => {
        requestBody = (await request.json()) as { score?: number };
        return HttpResponse.json({ upserted: 1 });
      }),
    );
    const { onRecorded } = await renderDialog({
      milestoneId: 'm-1',
      enrollmentIdPrefill: 'enr-1',
      studentId: 'student-1',
    });

    await user.type(screen.getByLabelText('Score'), '৮৫');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
    expect(requestBody.score).toBe(85);
  });

  it('shows a visible error for a non-numeric score and does not submit', async () => {
    const user = userEvent.setup();
    const { onRecorded } = await renderDialog({
      milestoneId: 'm-1',
      enrollmentIdPrefill: 'enr-1',
      studentId: 'student-1',
    });

    await user.type(screen.getByLabelText('Score'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Enter the score as a number.');
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('asks before discarding when Cancel is pressed after a change', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = await renderDialog({ milestoneId: 'm-1' });
    await screen.findByText('Bilal Hasan');
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Discard changes' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
