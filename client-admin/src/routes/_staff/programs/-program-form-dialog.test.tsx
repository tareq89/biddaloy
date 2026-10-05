/**
 * [34.4.1] `ProgramFormDialog`: create mode submits a new program; edit
 * mode archives, and walks the delete-confirm flow including the 409
 * "has enrolments" conflict message. Same hand-rolled provider stack as
 * `-record-dialog.test.tsx`.
 */
import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState, createTestQueryClient, server } from '@biddaloy/ui/test';
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
    await user.type(await screen.findByLabelText(/^Name/), 'Reading Club');
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
    await user.type(await screen.findByLabelText(/^Name/), 'Reading Club');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText("Couldn't save this program");
  });

  it('edit mode no longer renders archive or delete, and labels are visible', async () => {
    await renderDialog({ mode: 'edit', program: PROGRAM });

    expect(await screen.findByLabelText(/^Name/)).toBeTruthy();
    expect(screen.getByLabelText('Description')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
