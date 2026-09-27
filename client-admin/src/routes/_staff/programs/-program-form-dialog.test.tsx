/**
 * [34.4.1] `ProgramFormDialog`: create mode submits a new program; edit
 * mode archives, and walks the delete-confirm flow including the 409
 * "has enrolments" conflict message. Same hand-rolled provider stack as
 * `-record-dialog.test.tsx`.
 */
import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
import { apiErrorBody, cleanupTestState, createTestQueryClient, server } from '@biddaloy/ui/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProgramFormDialog, type ProgramFormDialogProps } from './-program-form-dialog';

afterEach(async () => {
  await cleanupTestState();
});

const PROGRAM = {
  id: 'p-1',
  name: 'Reading Club',
  description: null,
  is_active: true,
  show_on_report_card: false,
  active_enrollment_count: 0,
};

async function renderDialog(props: Partial<ProgramFormDialogProps> = {}) {
  await i18n.changeLanguage('en');
  setActiveTenant('tenant-1');
  setActiveRole('ADMIN');

  const queryClient = createTestQueryClient();
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ProgramFormDialog
          open
          onOpenChange={onOpenChange}
          mode="create"
          onSaved={onSaved}
          {...props}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );

  return { ...view, onOpenChange, onSaved };
}

describe('ProgramFormDialog', () => {
  it('creates a program on submit', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    server.use(
      http.post('/api/v1/programs', async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json(PROGRAM);
      }),
    );

    const { onSaved } = await renderDialog();
    await user.type(await screen.findByLabelText('Name'), 'Reading Club');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requestBody).toMatchObject({ name: 'Reading Club' });
  });

  it('shows the error message when create fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/v1/programs', () => HttpResponse.json({ message: 'nope' }, { status: 500 })),
    );

    await renderDialog();
    await user.type(await screen.findByLabelText('Name'), 'Reading Club');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText("Couldn't save this program");
  });

  it('archives an active program in edit mode', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    server.use(
      http.patch('/api/v1/programs/:id', async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ ...PROGRAM, is_active: false });
      }),
    );

    const { onSaved } = await renderDialog({ mode: 'edit', program: PROGRAM });
    await user.click(await screen.findByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requestBody).toMatchObject({ is_active: false });
  });

  it('disables delete and shows a hint when the program has enrolments', async () => {
    await renderDialog({
      mode: 'edit',
      program: { ...PROGRAM, active_enrollment_count: 3 },
    });

    expect((await screen.findByRole('button', { name: 'Delete' })).hasAttribute('disabled')).toBe(
      true,
    );
    await screen.findByText('This program has enrolled students — archive it instead of deleting.');
  });

  it('confirms and deletes, showing the 409 conflict message on failure', async () => {
    const user = userEvent.setup();
    server.use(
      http.delete('/api/v1/programs/:id', () =>
        HttpResponse.json(apiErrorBody(409, 'Has enrolments', '/programs/p-1'), { status: 409 }),
      ),
    );

    await renderDialog({ mode: 'edit', program: PROGRAM });
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await screen.findByText('This program has enrolled students — archive it instead of deleting.');
  });

  it('cancels the delete confirmation', async () => {
    const user = userEvent.setup();
    await renderDialog({ mode: 'edit', program: PROGRAM });

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await screen.findByText("Delete this program? This can't be undone.");
    // Two "Cancel" buttons exist once the confirm block is open (its own,
    // plus the dialog footer's) — the confirm block's is first in the DOM.
    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);

    expect(screen.queryByText("Delete this program? This can't be undone.")).toBeNull();
  });
});
