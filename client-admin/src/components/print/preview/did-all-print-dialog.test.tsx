import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DidAllPrintDialog } from './did-all-print-dialog';

const items = [
  { id: 'i-1', label: 'Rahim' },
  { id: 'i-2', label: 'Karim' },
  { id: 'i-3', label: 'Salma' },
];

function setup(onConfirm = vi.fn().mockResolvedValue(undefined)) {
  const onReprintFailed = vi.fn();
  const onContinue = vi.fn();
  const view = renderWithProviders(
    <DidAllPrintDialog
      open
      items={items}
      onConfirm={onConfirm}
      onReprintFailed={onReprintFailed}
      onContinue={onContinue}
    />,
    { locale: 'en', role: 'ADMIN', tenantId: 'school-1' },
  );
  return { ...view, onConfirm, onReprintFailed, onContinue };
}

describe('DidAllPrintDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('"Yes" saves an empty failed list, and offers no reprint', async () => {
    const { user, onConfirm } = setup();
    expect(await screen.findByText('Did all 3 cards print correctly?')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Yes, all printed' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith([]));
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reprint/ })).toBeNull();
  });

  it('ticking two cards saves exactly those, and then offers to reprint them', async () => {
    const { user, onConfirm, onReprintFailed } = setup();
    await user.click(await screen.findByRole('button', { name: 'Some failed…' }));

    await user.click(screen.getByRole('checkbox', { name: 'Rahim' }));
    await user.click(screen.getByRole('checkbox', { name: 'Salma' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(['i-1', 'i-3']));
    await user.click(await screen.findByRole('button', { name: 'Reprint 2 failed' }));
    expect(onReprintFailed).toHaveBeenCalledWith(['i-1', 'i-3']);
  });

  it('shows an error and stays on the question when the answer could not be saved', async () => {
    const { user } = setup(vi.fn().mockRejectedValue(new Error('down')));
    await user.click(await screen.findByRole('button', { name: 'Yes, all printed' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yes, all printed' })).toBeTruthy(); // can try again
  });

  it('Continue hands control back', async () => {
    const { user, onContinue } = setup();
    await user.click(await screen.findByRole('button', { name: 'Yes, all printed' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('is a small dialog', async () => {
    setup();
    expect((await screen.findByRole('dialog')).className).toContain('max-w-100');
  });
});
