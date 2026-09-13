/**
 * [16.3.7] `BatchActions`'s kebab menu — the ticket's own `## Tests`:
 * "delete uncollected -> no approval modal; delete with mocked 403 ->
 * approval modal -> retry; 409 rendering."
 *
 * Rendered standalone with `renderWithProviders` rather than through a
 * route: this component isn't itself a route, and #654 (which wires it
 * into the generation log page) is a separate, parallel ticket.
 */
import { apiErrorBody, cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { BatchActions, type BatchActionsGeneration } from './batch-actions';

afterEach(async () => {
  await cleanupTestState();
});

function generation(overrides: Partial<BatchActionsGeneration> = {}): BatchActionsGeneration {
  return {
    id: 'gen-1',
    period_start: '2026-09-01T00:00:00.000Z',
    period_type: 'MONTH',
    due_date: '2026-09-10T00:00:00.000Z',
    student_count: 30,
    generated_count: 30,
    collected_count: 0,
    ...overrides,
  };
}

function render(overrides: Partial<BatchActionsGeneration> = {}) {
  return renderWithProviders(
    <BatchActions generation={generation(overrides)} onChanged={() => {}} />,
    {
      locale: 'en',
      tenantId: 'tenant-1',
    },
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Batch actions' }));
}

describe('BatchActions', () => {
  it('removes uncollected bills without ever opening the approval modal', async () => {
    server.use(
      http.post('/api/v1/fees/generations/gen-1/remove-uncollected', () =>
        HttpResponse.json({ removed_count: 12 }),
      ),
    );

    const user = userEvent.setup();
    const { localeReady } = render();
    await localeReady;

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove uncollected' }));
    await user.click(screen.getByRole('button', { name: 'Remove uncollected' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByLabelText('Email or phone')).toBeNull();
  });

  it('opens the approval modal on a 403 delete, then completes the delete on retry', async () => {
    let attempt = 0;
    server.use(
      http.delete('/api/v1/fees/generations/gen-1', () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            {
              ...apiErrorBody(403, 'Approval required', '/fees/generations/gen-1'),
              details: { code: 'APPROVAL_REQUIRED' },
            },
            { status: 403 },
          );
        }
        return new HttpResponse(null, { status: 204 });
      }),
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json(
          { approval_token: 'tok-1', approver: { id: 'u1', name: 'Admin' } },
          { status: 201 },
        ),
      ),
    );

    const user = userEvent.setup();
    const { localeReady } = render({ collected_count: 3, generated_count: 30 });
    await localeReady;

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete batch' }));
    expect(
      screen.getByText(
        '3 of 30 bills already have payments — admin approval will be required to delete this batch.',
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete batch' }));

    await screen.findByLabelText('Email or phone');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(attempt).toBe(2);
  });

  it('does not show the approval notice when nothing has been collected', async () => {
    const user = userEvent.setup();
    const { localeReady } = render({ collected_count: 0, generated_count: 30 });
    await localeReady;

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete batch' }));

    expect(
      screen.queryByText(/bills already have payments — admin approval will be required/),
    ).toBeNull();
  });

  it('shows conflict copy on a 409 delete response', async () => {
    server.use(
      http.delete('/api/v1/fees/generations/gen-1', () =>
        HttpResponse.json(apiErrorBody(409, 'Conflict', '/fees/generations/gen-1'), {
          status: 409,
        }),
      ),
    );

    const user = userEvent.setup();
    const { localeReady } = render();
    await localeReady;

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete batch' }));
    await user.click(screen.getByRole('button', { name: 'Delete batch' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('This batch could not be deleted — refresh and try again.');
  });

  it('shows generic error copy on a non-409 delete error', async () => {
    server.use(
      http.delete('/api/v1/fees/generations/gen-1', () =>
        HttpResponse.json(apiErrorBody(500, 'Internal Server Error', '/fees/generations/gen-1'), {
          status: 500,
        }),
      ),
    );

    const user = userEvent.setup();
    const { localeReady } = render();
    await localeReady;

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete batch' }));
    await user.click(screen.getByRole('button', { name: 'Delete batch' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not delete this batch. Try again.');
  });

  it('opens the edit-period dialog from the kebab menu', async () => {
    const user = userEvent.setup();
    const { localeReady } = render();
    await localeReady;

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit period / due date' }));

    expect(await screen.findByRole('heading', { name: 'Edit period & due date' })).toBeTruthy();
  });

  it('saving the edit-period dialog closes it', async () => {
    server.use(
      http.patch('/api/v1/fees/generations/gen-1', () =>
        HttpResponse.json({
          id: 'gen-1',
          period_start: '2026-10-01T00:00:00.000Z',
          period_type: 'MONTH',
          due_date: '2026-10-10T00:00:00.000Z',
        }),
      ),
    );

    const user = userEvent.setup();
    const { localeReady } = render();
    await localeReady;

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit period / due date' }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancelling the edit-period dialog closes it without saving', async () => {
    const user = userEvent.setup();
    const { localeReady } = render();
    await localeReady;

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit period / due date' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancelling the remove-uncollected dialog closes it without a request', async () => {
    let called = false;
    server.use(
      http.post('/api/v1/fees/generations/gen-1/remove-uncollected', () => {
        called = true;
        return HttpResponse.json({ removed_count: 1 });
      }),
    );

    const user = userEvent.setup();
    const { localeReady } = render();
    await localeReady;

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove uncollected' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(called).toBe(false);
  });

  it('cancelling the delete-batch dialog closes it without a request', async () => {
    let called = false;
    server.use(
      http.delete('/api/v1/fees/generations/gen-1', () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    const { localeReady } = render();
    await localeReady;

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete batch' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(called).toBe(false);
  });

  it('shows an error message when remove-uncollected fails', async () => {
    server.use(
      http.post('/api/v1/fees/generations/gen-1/remove-uncollected', () =>
        HttpResponse.json(
          apiErrorBody(500, 'Internal Server Error', '/fees/generations/gen-1/remove-uncollected'),
          { status: 500 },
        ),
      ),
    );

    const user = userEvent.setup();
    const { localeReady } = render();
    await localeReady;

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove uncollected' }));
    await user.click(screen.getByRole('button', { name: 'Remove uncollected' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not remove uncollected bills. Try again.');
  });

  it('closes the menu-driven remove-uncollected dialog and reports success', async () => {
    server.use(
      http.post('/api/v1/fees/generations/gen-1/remove-uncollected', () =>
        HttpResponse.json({ removed_count: 7 }),
      ),
    );

    const user = userEvent.setup();
    const { localeReady } = render();
    await localeReady;

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove uncollected' }));
    expect(screen.getByRole('heading', { name: 'Remove uncollected bills' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove uncollected' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
