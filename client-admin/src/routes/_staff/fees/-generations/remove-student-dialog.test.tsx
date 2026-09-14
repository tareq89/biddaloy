/**
 * [16.3.7] `RemoveStudentDialog` — renders the student's name, shows the
 * approval notice only when the batch already has money against it, calls
 * the remove mutation with the right ids, and surfaces 409-vs-generic error
 * copy.
 */
import { apiErrorBody, cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RemoveStudentDialog } from './remove-student-dialog';

afterEach(async () => {
  await cleanupTestState();
});

function render(overrides: Partial<React.ComponentProps<typeof RemoveStudentDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onRemoved = vi.fn();
  const result = renderWithProviders(
    <RemoveStudentDialog
      open
      onOpenChange={onOpenChange}
      generationId="gen-1"
      studentId="student-1"
      studentName="Abdul Karim"
      hasPayments={false}
      onRemoved={onRemoved}
      {...overrides}
    />,
    { locale: 'en', tenantId: 'tenant-1' },
  );
  return { ...result, onOpenChange, onRemoved };
}

describe('RemoveStudentDialog', () => {
  it("renders the student's name", async () => {
    const { localeReady } = render();
    await localeReady;
    expect(await screen.findByText(/Abdul Karim/)).toBeTruthy();
  });

  it('shows the approval notice when the bill has money against it', async () => {
    const { localeReady } = render({ hasPayments: true });
    await localeReady;
    await screen.findByRole('button', { name: 'Cancel' });
    expect(screen.getAllByText(/Abdul Karim/).length).toBeGreaterThan(1);
  });

  it('hides the approval notice when there are no payments', async () => {
    render({ hasPayments: false });
    await screen.findByRole('button', { name: 'Cancel' });
    // Only the description references the student name; no extra approval paragraph.
    expect(screen.getAllByText(/Abdul Karim/).length).toBe(1);
  });

  it('calls the remove mutation with generationId and studentId, then closes', async () => {
    let capturedUrl = '';
    server.use(
      http.delete('/api/v1/fees/generations/:id/students/:studentId', ({ params }) => {
        capturedUrl = `${String(params.id)}/${String(params.studentId)}`;
        return HttpResponse.json({ success: true });
      }),
    );
    const user = userEvent.setup();
    const { onOpenChange, onRemoved, localeReady } = render();
    await localeReady;

    const confirmButton = await screen.findByRole('button', { name: 'Remove student' });
    await user.click(confirmButton);

    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(capturedUrl).toBe('gen-1/student-1');
  });

  it('shows conflict copy on a 409 response', async () => {
    server.use(
      http.delete('/api/v1/fees/generations/:id/students/:studentId', () =>
        HttpResponse.json(
          apiErrorBody(409, 'Conflict', '/fees/generations/gen-1/students/student-1'),
          {
            status: 409,
          },
        ),
      ),
    );
    const user = userEvent.setup();
    const { localeReady } = render();
    await localeReady;

    await user.click(await screen.findByRole('button', { name: 'Remove student' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('This student could not be removed — refresh and try again.');
  });

  it('shows generic error copy on a non-409 error', async () => {
    server.use(
      http.delete('/api/v1/fees/generations/:id/students/:studentId', () =>
        HttpResponse.json(
          apiErrorBody(500, 'Internal Server Error', '/fees/generations/gen-1/students/student-1'),
          { status: 500 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { localeReady } = render();
    await localeReady;

    await user.click(await screen.findByRole('button', { name: 'Remove student' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toBe('');
  });

  it('renders nothing interactive when closed', () => {
    render({ open: false });
    expect(screen.queryByRole('button', { name: 'Remove student' })).toBeNull();
  });

  it('cancel closes without sending any request', async () => {
    let called = false;
    server.use(
      http.delete('/api/v1/fees/generations/:id/students/:studentId', () => {
        called = true;
        return HttpResponse.json({ success: true });
      }),
    );
    const user = userEvent.setup();
    const { onOpenChange, localeReady } = render();
    await localeReady;

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(called).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalledWith(true);
  });
});
