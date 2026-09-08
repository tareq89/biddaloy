import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GrantSmsCreditsForm } from './grant-sms-credits-form';

describe('GrantSmsCreditsForm', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('rejects a zero units value and a too-short reason without submitting', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithProviders(
      <GrantSmsCreditsForm
        submitting={false}
        onFieldsChange={() => undefined}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    await user.type(await screen.findByLabelText(/Units/), '0');
    await user.type(screen.getByLabelText('Reason'), 'no');
    await user.click(screen.getByRole('button', { name: 'Grant / adjust' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  });

  it('submits parsed units and reason once both are valid', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithProviders(
      <GrantSmsCreditsForm
        submitting={false}
        onFieldsChange={() => undefined}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    await user.type(await screen.findByLabelText(/Units/), '500');
    await user.type(screen.getByLabelText('Reason'), 'Initial top-up');
    await user.click(screen.getByRole('button', { name: 'Grant / adjust' }));

    expect(onSubmit).toHaveBeenCalledWith({ units: 500, reason: 'Initial top-up' });
  });

  it('accepts a negative value to adjust the balance down', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithProviders(
      <GrantSmsCreditsForm
        submitting={false}
        onFieldsChange={() => undefined}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    await user.type(await screen.findByLabelText(/Units/), '-50');
    await user.type(screen.getByLabelText('Reason'), 'Correcting an over-grant');
    await user.click(screen.getByRole('button', { name: 'Grant / adjust' }));

    expect(onSubmit).toHaveBeenCalledWith({ units: -50, reason: 'Correcting an over-grant' });
  });

  it('calls onFieldsChange as the user edits', async () => {
    const onFieldsChange = vi.fn();
    const { user } = renderWithProviders(
      <GrantSmsCreditsForm
        submitting={false}
        onFieldsChange={onFieldsChange}
        onSubmit={() => undefined}
      />,
      { locale: 'en' },
    );

    await user.type(await screen.findByLabelText(/Units/), '1');
    expect(onFieldsChange).toHaveBeenCalled();
  });

  it('shows a server-side submit error', () => {
    renderWithProviders(
      <GrantSmsCreditsForm
        submitting={false}
        submitError="units must be a non-zero integer"
        onFieldsChange={() => undefined}
        onSubmit={() => undefined}
      />,
      { locale: 'en' },
    );

    expect(screen.getByRole('alert').textContent).toBe('units must be a non-zero integer');
  });
});
