import '@biddaloy/ui/test';

import { apiErrorBody, cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TemplateFormDialog } from './-template-form-dialog';

const onSaved = vi.fn();

async function renderDialog(props: Partial<React.ComponentProps<typeof TemplateFormDialog>> = {}) {
  const user = userEvent.setup();
  const view = renderWithProviders(
    <TemplateFormDialog open onOpenChange={() => {}} onSaved={onSaved} {...props} />,
    { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
  );
  await view.localeReady;
  return user;
}

describe('TemplateFormDialog', () => {
  afterEach(async () => {
    onSaved.mockReset();
    await cleanupTestState();
  });

  it('an empty name shows the required message under the field', async () => {
    const user = await renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Create' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Name is required.');
  });

  it('a 409 shows the translated duplicate line, not the server text', async () => {
    server.use(
      http.post('/api/v1/exam-templates', () =>
        HttpResponse.json(apiErrorBody(409, 'Template "X" already exists', '/api/v1/exam-templates'), {
          status: 409,
        }),
      ),
    );
    const user = await renderDialog();
    await user.type(screen.getByLabelText('Name'), 'Half-yearly');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Another exam structure already has this name.');
    expect(screen.queryByText(/already exists/)).toBeNull();
  });

  it('edit mode is prefilled and sends PATCH with name and type', async () => {
    let body: unknown = null;
    server.use(
      http.patch('/api/v1/exam-templates/t1', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 't1', name: 'Renamed', kind: 'MODEL', rows: [] });
      }),
    );
    const user = await renderDialog({
      mode: 'edit',
      initial: { id: 't1', name: 'Half-yearly', kind: 'TERM' },
    });

    expect(screen.getByText('Change name and type')).toBeTruthy();
    const input = screen.getByLabelText('Name');
    expect(input.value).toBe('Half-yearly');
    await user.clear(input);
    await user.type(input, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toEqual({ name: 'Renamed', kind: 'TERM' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
