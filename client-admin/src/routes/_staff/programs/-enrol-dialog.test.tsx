/**
 * [34.4.1], D16 — `EnrolDialog`: class → section selects filter the student
 * multi-select, "select all" toggles every visible student, submitting
 * calls `useEnrolStudents` and `onEnrolled`, and a skipped-count response
 * shows the skip message instead of closing. Same hand-rolled provider
 * stack as `-record-dialog.test.tsx`.
 */
import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState, createTestQueryClient, server } from '@biddaloy/ui/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnrolDialog, type EnrolDialogProps } from './-enrol-dialog';

afterEach(async () => {
  await cleanupTestState();
});

const PROGRAM = {
  id: 'p-1',
  name: 'Reading Club',
  description: null,
  is_active: true,
  show_on_report_card: false,
  milestones: [],
};

const CLASSES = { data: [{ id: 'class-1', name: 'Class 5' }], total: 1 };
const SECTIONS = [{ id: 'sec-1', section_name: 'A', enrolled_count: 2 }];
const STUDENTS = {
  data: [
    { id: 'student-1', full_name: 'Anika Rahman' },
    { id: 'student-2', full_name: 'Bilal Hasan' },
  ],
  total: 2,
};

async function renderDialog(props: Partial<EnrolDialogProps> = {}) {
  await i18n.changeLanguage('en');
  setActiveTenant('tenant-1');
  setActiveRole('ADMIN');

  server.use(
    http.get('/api/v1/programs', () => HttpResponse.json([PROGRAM])),
    http.get('/api/v1/classes', () => HttpResponse.json(CLASSES)),
    http.get('/api/v1/classes/:id/sections', () => HttpResponse.json(SECTIONS)),
    http.get('/api/v1/students', () => HttpResponse.json(STUDENTS)),
  );

  const queryClient = createTestQueryClient();
  const onOpenChange = vi.fn();
  const onEnrolled = vi.fn();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <EnrolDialog
          open
          onOpenChange={onOpenChange}
          programId="p-1"
          onEnrolled={onEnrolled}
          {...props}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );

  return { ...view, onOpenChange, onEnrolled };
}

describe('EnrolDialog', () => {
  it('opens with the students list empty until a class is picked', async () => {
    await renderDialog();

    await screen.findByRole('heading', { level: 1, name: 'Enrol students' });
    expect(screen.queryByText('Anika Rahman')).toBeNull();
    expect(screen.getByText('Choose a class to see its students.')).toBeTruthy();
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it('filters students by class + section, selects all, and submits', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    server.use(
      http.post('/api/v1/programs/:id/enrollments', async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ enrolled: 2, skipped: 0 });
      }),
    );

    const { onEnrolled } = await renderDialog();

    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 5' }));

    await user.click(screen.getByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'A' }));

    await screen.findByText('Anika Rahman');
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Enrol' }));

    await waitFor(() => expect(onEnrolled).toHaveBeenCalled());
    expect(requestBody).toMatchObject({
      student_ids: expect.arrayContaining(['student-1', 'student-2']),
    });
  });

  it('shows the skip message and does not close when some students are already enrolled', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/v1/programs/:id/enrollments', () =>
        HttpResponse.json({ enrolled: 1, skipped: 1 }),
      ),
    );

    const { onEnrolled } = await renderDialog({ studentIdPrefill: 'student-1' });

    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 5' }));
    await screen.findByText('Anika Rahman');

    await user.click(screen.getByRole('button', { name: 'Enrol' }));

    await screen.findByText(/already enrolled, skipped/i);
    expect(onEnrolled).not.toHaveBeenCalled();
  });

  it('sends today as the started-on date, in local calendar terms', async () => {
    const user = userEvent.setup();
    let requestBody: { started_on?: string } = {};
    server.use(
      http.post('/api/v1/programs/:id/enrollments', async ({ request }) => {
        requestBody = (await request.json()) as { started_on?: string };
        return HttpResponse.json({ enrolled: 1, skipped: 0 });
      }),
    );
    // Local 01:00 on 4 Oct — the UTC day (3 Oct) must not leak into the payload.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 4, 1, 0, 0) });
    try {
      await renderDialog({ studentIdPrefill: 'student-1' });
      await user.click(screen.getByRole('button', { name: 'Enrol' }));
      await waitFor(() => expect(requestBody.started_on).toBe('2026-10-04'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks before discarding when students are ticked and Cancel is pressed', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = await renderDialog({ studentIdPrefill: 'student-1' });
    await user.click(screen.getByRole('combobox', { name: /Class/ }));
    await user.click(await screen.findByRole('option', { name: 'Class 5' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Discard changes' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
