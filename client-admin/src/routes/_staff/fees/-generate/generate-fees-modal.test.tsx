import { getNotifications } from '@biddaloy/ui/api';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GenerateFeesModal } from './generate-fees-modal';

function approvalRequiredBody() {
  return HttpResponse.json(
    {
      statusCode: 403,
      message: 'Approval required',
      timestamp: new Date().toISOString(),
      path: '/fees/generate',
      requestId: 'req-1',
      details: { code: 'APPROVAL_REQUIRED' },
    },
    { status: 403 },
  );
}

async function renderModal() {
  const onOpenChange = vi.fn();
  const view = renderWithProviders(<GenerateFeesModal open onOpenChange={onOpenChange} />, {
    tenantId: 'tenant-1',
    locale: 'en',
  });
  await view.localeReady;
  return { ...view, onOpenChange };
}

describe('GenerateFeesModal', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the matched count after "Select all N matching"', async () => {
    server.use(
      http.get('/api/v1/students/ids', () =>
        HttpResponse.json({
          ids: Array.from({ length: 120 }, (_, i) => `student-${i}`),
          total: 120,
        }),
      ),
    );

    const user = userEvent.setup();
    await renderModal();

    await user.click(await screen.findByRole('button', { name: /Select all/ }));

    await screen.findByText('120 selected');
  });

  it('disables Generate when no fee structures are selected', async () => {
    await renderModal();
    const generateButton = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Generate fees',
    });
    expect(generateButton.disabled).toBe(true);
  });

  it('shows the duplicates step when the preview reports duplicates', async () => {
    server.use(
      http.get('/api/v1/students/ids', () => HttpResponse.json({ ids: ['student-1'], total: 1 })),
      http.post('/api/v1/fees/generate/preview', () =>
        HttpResponse.json({
          students_evaluated: 1,
          will_generate: 0,
          duplicates: [
            {
              student_id: 'student-1',
              student_name: 'Rahim Uddin',
              fee_structure_id: 'fee-1',
              fee_structure_name: 'Tuition',
              existing_fee_id: 'existing-1',
              existing_created_at: new Date().toISOString(),
            },
          ],
          inactive_students: [],
        }),
      ),
    );

    const user = userEvent.setup();
    await renderModal();

    await user.click(await screen.findByRole('button', { name: /Select all/ }));

    // Select at least one fee structure so Generate is enabled.
    const feePicker = await screen.findByTestId('fee-picker');
    const feeCheckboxes = await within(feePicker).findAllByRole('checkbox');
    await user.click(feeCheckboxes[0]!);

    await user.click(screen.getByRole('button', { name: 'Generate fees' }));

    await screen.findByText('Some fees already exist for this period');
  });

  it('CREATE_ANYWAY triggers the approval flow: a 403 then a retried success', async () => {
    server.use(
      http.get('/api/v1/students/ids', () => HttpResponse.json({ ids: ['student-1'], total: 1 })),
      http.post('/api/v1/fees/generate/preview', () =>
        HttpResponse.json({
          students_evaluated: 1,
          will_generate: 0,
          duplicates: [
            {
              student_id: 'student-1',
              student_name: 'Rahim Uddin',
              fee_structure_id: 'fee-1',
              fee_structure_name: 'Tuition',
              existing_fee_id: 'existing-1',
              existing_created_at: new Date().toISOString(),
            },
          ],
          inactive_students: [],
        }),
      ),
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json(
          { approval_token: 'tok-123', approver: { id: 'u1', name: 'Admin' } },
          { status: 201 },
        ),
      ),
    );

    let generateCalls = 0;
    server.use(
      http.post('/api/v1/fees/generate', () => {
        generateCalls += 1;
        if (generateCalls === 1) return approvalRequiredBody();
        return HttpResponse.json(
          { generated: 1, skipped: 0, students_evaluated: 1 },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    await renderModal();

    await user.click(await screen.findByRole('button', { name: /Select all/ }));
    const feePicker = await screen.findByTestId('fee-picker');
    const feeCheckboxes = await within(feePicker).findAllByRole('checkbox');
    await user.click(feeCheckboxes[0]!);

    await user.click(screen.getByRole('button', { name: 'Generate fees' }));
    await screen.findByText('Some fees already exist for this period');

    await user.click(screen.getByRole('radio', { name: /Create anyway/ }));
    await user.click(screen.getByRole('button', { name: 'Generate fees' }));

    // 403 APPROVAL_REQUIRED opens the step-up modal.
    await user.type(await screen.findByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(generateCalls).toBe(2));
  });

  it('shows the generated/skipped toast and closes on success', async () => {
    server.use(
      http.get('/api/v1/students/ids', () => HttpResponse.json({ ids: ['student-1'], total: 1 })),
      http.post('/api/v1/fees/generate/preview', () =>
        HttpResponse.json({
          students_evaluated: 1,
          will_generate: 1,
          duplicates: [],
          inactive_students: [],
        }),
      ),
      http.post('/api/v1/fees/generate', () =>
        HttpResponse.json({ generated: 60, skipped: 2, students_evaluated: 30 }, { status: 201 }),
      ),
    );

    const user = userEvent.setup();
    const { onOpenChange } = await renderModal();

    await user.click(await screen.findByRole('button', { name: /Select all/ }));
    const feePicker = await screen.findByTestId('fee-picker');
    const feeCheckboxes = await within(feePicker).findAllByRole('checkbox');
    await user.click(feeCheckboxes[0]!);

    await user.click(screen.getByRole('button', { name: 'Generate fees' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(getNotifications()[0]?.message).toBe('Generated 60 bills for 30 students (2 skipped).');
  });
});
