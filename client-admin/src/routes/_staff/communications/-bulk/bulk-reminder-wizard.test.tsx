/**
 * [8.11.9]'s bulk fee-reminder wizard, mounted at
 * `/communications/reminders?mode=bulk` — real route tree, same
 * reasoning `reminders.test.tsx` gives for the single-student page.
 *
 * The two behaviors that matter most, in order:
 * 1. Recipients come from **explicit selection**, never from the dues
 *    filters alone — Next stays disabled at zero selected.
 * 2. Submit is enabled only while the server preview matches the
 *    current inputs — editing any earlier step re-disables it until the
 *    preview is re-run (a queued bulk SMS cannot be recalled).
 */
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const STUDENT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const STUDENT_B = 'bbbbbbbb-0000-0000-0000-000000000002';

function dueRow(studentId: string, name: string, registration: string) {
  return {
    student_id: studentId,
    full_name: name,
    registration_number: registration,
    roll_number: 1,
    class_name: 'One',
    section_name: 'A',
    total_due: 1200,
    months_overdue: 2,
    dues: [],
  };
}

/** Two fixed rows so "Select row 1"/"Select row 2" map to known ids. */
function duesHandler() {
  return http.get('/api/v1/fees/dues', () =>
    HttpResponse.json({
      data: [
        dueRow(STUDENT_A, 'Arif Hossain', '12345678'),
        dueRow(STUDENT_B, 'Mitu Akter', '87654321'),
      ],
      total: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
    }),
  );
}

function render() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/communications/reminders?mode=bulk'],
    tenantId: 'tenant-1',
    role: 'ACCOUNTANT',
    locale: 'en',
  });
}

/** The wizard's own Next — the recipients step's `DataTable` renders a
 * pagination "Next" too, so the bare name is ambiguous there. WizardShell's
 * footer is the last thing in the DOM, so its Next is always last. */
function wizardNext(): HTMLButtonElement {
  const buttons = screen.getAllByRole<HTMLButtonElement>('button', { name: 'Next' });
  return buttons[buttons.length - 1] as HTMLButtonElement;
}

async function selectBothStudents(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('checkbox', { name: 'Select row 1' }));
  await user.click(screen.getByRole('checkbox', { name: 'Select row 2' }));
}

async function fillMessageStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(wizardNext());
  await user.type(screen.getByRole('textbox', { name: 'Batch name' }), 'August dues');
  await user.click(screen.getByRole('textbox', { name: 'Message template' }));
  await user.paste('Dear {{guardian_name}}, dues are open.');
}

describe('bulk reminder wizard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('opens from the single-reminder page via the Bulk reminders button', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/communications/reminders'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await user.click(await screen.findByRole('button', { name: 'Bulk reminders' }));
    expect(await screen.findByRole('heading', { name: 'Bulk Fee Reminders' })).toBeTruthy();
    // And back again — the wizard's escape hatch to the single form.
    await user.click(screen.getByRole('button', { name: 'Single reminder' }));
    expect(await screen.findByRole('heading', { name: 'Fee Reminders' })).toBeTruthy();
  });

  it('requires explicit selection: Next is disabled at zero selected and the counter tracks picks', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: 'Select row 1' });
    // Filters populated a table, but nothing is selected — the filters
    // alone never define the recipient set.
    expect(screen.getByText('0 of 500 students selected')).toBeTruthy();
    expect(wizardNext().disabled).toBe(true);

    await selectBothStudents(user);
    expect(screen.getByText('2 of 500 students selected')).toBeTruthy();
    expect(wizardNext().disabled).toBe(false);
  });

  it('keeps submit disabled until a preview runs, and re-disables it when an earlier step changes', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: 'Select row 1' });
    await selectBothStudents(user);
    await fillMessageStep(user);
    await user.click(wizardNext());

    // On review: never previewed — the standing rule.
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Send reminders' });
    expect(submit.disabled).toBe(true);
    expect(screen.getByText('Run the preview to enable sending.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    // MSW's default bulk preview echoes both students back as recipients.
    await screen.findByText('2 guardian(s) will receive this reminder · 1 skipped');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send reminders' }).disabled).toBe(
      false,
    );

    // Mutate an earlier step: the completed "Message" crumb is a button.
    await user.click(screen.getByRole('button', { name: 'Message' }));
    await user.click(screen.getByRole('textbox', { name: 'Message template' }));
    await user.paste(' Pay soon.');
    await user.click(wizardNext());

    // Previewed-then-edited — the staleness warning, submit re-disabled.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send reminders' }).disabled).toBe(
      true,
    );
    expect(
      screen.getByText(
        'The earlier steps changed since the last preview — preview again before sending.',
      ),
    ).toBeTruthy();
  });

  it('rejects unsupported placeholders on the message step before any request', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: 'Select row 1' });
    await selectBothStudents(user);
    await user.click(wizardNext());
    await user.type(screen.getByRole('textbox', { name: 'Batch name' }), 'August dues');
    await user.click(screen.getByRole('textbox', { name: 'Message template' }));
    await user.paste('Dear {{parent_name}}');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('{{parent_name}}');
    expect(wizardNext().disabled).toBe(true);
  });

  it('submits the exact composed body and links to the created batch', async () => {
    let sentBody: Record<string, unknown> | undefined;
    server.use(
      duesHandler(),
      http.post('/api/v1/communications/reminder/bulk', async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            id: 'batch-new-1',
            batch_name: 'August dues',
            status: 'PROCESSING',
            total_recipients: 2,
            successful_count: 0,
            failed_count: 0,
            message_template: 'Dear {{guardian_name}}, dues are open.',
            created_at: new Date().toISOString(),
            skipped: [],
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: 'Select row 1' });
    await selectBothStudents(user);
    await fillMessageStep(user);
    await user.click(wizardNext());
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByText('2 guardian(s) will receive this reminder · 1 skipped');
    await user.click(screen.getByRole('button', { name: 'Send reminders' }));

    await screen.findByText('“August dues” is being sent in the background.');
    expect(sentBody).toEqual({
      student_ids: [STUDENT_A, STUDENT_B],
      message_template: 'Dear {{guardian_name}}, dues are open.',
      batch_name: 'August dues',
      mediums: ['EMAIL', 'SMS', 'WHATSAPP'],
    });

    const link = screen.getByRole<HTMLAnchorElement>('link', { name: 'View batch progress' });
    expect(link.getAttribute('href')).toBe('/communications/batches/batch-new-1');
  });

  it('completes the review step with the keyboard alone', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: 'Select row 1' });
    await selectBothStudents(user);
    await fillMessageStep(user);
    await user.click(wizardNext());

    // Keyboard-only from here: focus the preview button, activate it,
    // then reach and activate submit — [8.11.9]'s "preview step
    // keyboard-operable" AC.
    screen.getByRole('button', { name: 'Preview recipients' }).focus();
    await user.keyboard('{Enter}');
    await screen.findByText('2 guardian(s) will receive this reminder · 1 skipped');
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Send reminders' });
    expect(submit.disabled).toBe(false);
    submit.focus();
    await user.keyboard('{Enter}');
    await screen.findByText(/is being sent in the background\./);
  });

  it('surfaces the rate-limit note on a 429 from the bulk send', async () => {
    server.use(
      duesHandler(),
      http.post('/api/v1/communications/reminder/bulk', () =>
        HttpResponse.json(
          apiErrorBody(
            429,
            'ThrottlerException: Too Many Requests',
            '/api/v1/communications/reminder/bulk',
          ),
          { status: 429 },
        ),
      ),
    );
    const user = userEvent.setup();
    render();

    await screen.findByRole('checkbox', { name: 'Select row 1' });
    await selectBothStudents(user);
    await fillMessageStep(user);
    await user.click(wizardNext());
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByText('2 guardian(s) will receive this reminder · 1 skipped');
    await user.click(screen.getByRole('button', { name: 'Send reminders' }));

    await waitFor(() => {
      expect(
        screen.getByText('Too many bulk requests in a row — wait a moment and try again.'),
      ).toBeTruthy();
    });
  });

  it('is axe clean with the preview on screen', async () => {
    server.use(duesHandler());
    const user = userEvent.setup();
    const { container } = render();

    await screen.findByRole('checkbox', { name: 'Select row 1' });
    await selectBothStudents(user);
    await fillMessageStep(user);
    await user.click(wizardNext());
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByText('2 guardian(s) will receive this reminder · 1 skipped');

    await expect(container).toHaveNoViolations();
  });
});
