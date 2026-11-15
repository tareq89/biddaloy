import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OnlinePaymentsSection } from './OnlinePaymentsSection';

const SCHOOL_ID = 'school-1';
const PAYMENTS = {
  proofEnabled: false,
  proofMethods: [{ method: 'BKASH', instructions: 'Send Money to 01711-000000.' }],
};
const opts = { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID } as const;

function capturePatch() {
  const patchBody = vi.fn();
  server.use(
    http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
      patchBody(await request.json());
      return HttpResponse.json({ version: 1 });
    }),
  );
  return patchBody;
}

describe('OnlinePaymentsSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('toggle saves only payments.proofEnabled/proofMethods', async () => {
    const patchBody = capturePatch();
    const { user } = renderWithProviders(
      <OnlinePaymentsSection schoolId={SCHOOL_ID} payments={PAYMENTS} />,
      opts,
    );
    await user.click(await screen.findByLabelText('Allow payment proofs'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0]).toEqual({
      version: 1,
      payments: {
        proofEnabled: true,
        proofMethods: [{ method: 'BKASH', instructions: 'Send Money to 01711-000000.' }],
      },
    });
  });

  it('shows a live preview and ticking a method adds it to the save', async () => {
    const patchBody = capturePatch();
    const { user } = renderWithProviders(
      <OnlinePaymentsSection schoolId={SCHOOL_ID} payments={PAYMENTS} />,
      opts,
    );
    expect((await screen.findByTestId('preview-BKASH')).textContent).toBe(
      'Send Money to 01711-000000.',
    );
    await user.click(screen.getByLabelText('Nagad'));
    await user.type(screen.getAllByLabelText('What to tell the guardian')[1]!, 'Pay 0181');
    expect(screen.getByTestId('preview-NAGAD').textContent).toBe('Pay 0181');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0].payments.proofMethods).toEqual([
      { method: 'BKASH', instructions: 'Send Money to 01711-000000.' },
      { method: 'NAGAD', instructions: 'Pay 0181' },
    ]);
  });

  it('refuses instructions over 500 characters and does not send', async () => {
    const patchBody = capturePatch();
    const { user } = renderWithProviders(
      <OnlinePaymentsSection schoolId={SCHOOL_ID} payments={PAYMENTS} />,
      opts,
    );
    const box = await screen.findByLabelText('What to tell the guardian');
    fireEvent.change(box, { target: { value: 'x'.repeat(501) } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Use at most 500 characters.')).toBeTruthy();
    expect(patchBody).not.toHaveBeenCalled();
  });

  it('does not validate instructions of a method that was deselected', async () => {
    const patchBody = capturePatch();
    const { user } = renderWithProviders(
      <OnlinePaymentsSection schoolId={SCHOOL_ID} payments={PAYMENTS} />,
      opts,
    );
    fireEvent.change(await screen.findByLabelText('What to tell the guardian'), {
      target: { value: 'x'.repeat(501) },
    });
    await user.click(screen.getByLabelText('bKash'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0].payments.proofMethods).toEqual([]);
  });

  it('locks the controls while the save is pending', async () => {
    let release!: () => void;
    server.use(
      http.patch('/api/v1/schools/:id/settings', async () => {
        await new Promise<void>((resolve) => (release = resolve));
        return HttpResponse.json({ version: 1 });
      }),
    );
    const { user } = renderWithProviders(
      <OnlinePaymentsSection schoolId={SCHOOL_ID} payments={PAYMENTS} />,
      opts,
    );
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText('What to tell the guardian') as HTMLInputElement).disabled,
      ).toBe(true),
    );
    release();
  });
});
