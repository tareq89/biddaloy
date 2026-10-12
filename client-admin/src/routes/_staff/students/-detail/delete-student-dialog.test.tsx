import { toast } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeleteStudentDialog } from './delete-student-dialog';

function failDelete(status: number, details?: Record<string, unknown>) {
  return http.delete('/api/v1/students/s1', () =>
    HttpResponse.json(
      {
        statusCode: status,
        message: 'nope',
        timestamp: '2026-01-01T00:00:00.000Z',
        path: '/api/v1/students/s1',
        requestId: 'r1',
        ...(details ? { details } : {}),
      },
      { status },
    ),
  );
}

async function confirmDelete() {
  const view = renderWithProviders(
    <DeleteStudentDialog
      open
      onOpenChange={() => {}}
      studentId="s1"
      studentName="Karim"
      onDeleted={() => {}}
    />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  await view.localeReady;
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Delete' }));
}

describe('DeleteStudentDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the blocked reason on a STUDENT_HAS_OPEN_MONEY 409', async () => {
    // No <Toaster /> in the test harness, so assert the toast.error call.
    const spy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    server.use(failDelete(409, { code: 'STUDENT_HAS_OPEN_MONEY', open_dues: 500 }));
    await confirmDelete();
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.stringMatching(/still owes fees or has wallet money/),
      ),
    );
    spy.mockRestore();
  });

  it('shows the generic text on a 500', async () => {
    const spy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    server.use(failDelete(500));
    await confirmDelete();
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("Couldn't delete the student. Try again."),
    );
    spy.mockRestore();
  });
});
