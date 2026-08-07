import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SecretField } from './SecretField';

describe('SecretField', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows "Not configured" when nothing is stored', async () => {
    const { user } = renderWithProviders(
      <SecretField
        id="test-secret"
        label="Access token"
        masked={undefined}
        value={undefined}
        onChange={vi.fn()}
      />,
      { locale: 'en' },
    );
    await user.click(await screen.findByText('Not configured'));

    expect(screen.getByText('Not configured')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set' })).toBeTruthy();
  });

  it('shows the masked hint with Replace and Clear when configured', async () => {
    renderWithProviders(
      <SecretField
        id="test-secret"
        label="Access token"
        masked={{ configured: true, hint: '••••4821' }}
        value={undefined}
        onChange={vi.fn()}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('Configured — ends ••••4821')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
  });

  it('switches to an editable input when Replace is clicked, calling onChange with an empty string', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <SecretField
        id="test-secret"
        label="Access token"
        masked={{ configured: true, hint: '••••4821' }}
        value={undefined}
        onChange={onChange}
      />,
      { locale: 'en' },
    );

    await user.click(await screen.findByRole('button', { name: 'Replace' }));

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('renders an editable password input and reports typed values via onChange', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <SecretField
        id="test-secret"
        label="Access token"
        masked={{ configured: true, hint: '••••4821' }}
        value=""
        onChange={onChange}
      />,
      { locale: 'en' },
    );

    const input = document.getElementById('test-secret') as HTMLInputElement;
    expect(input.type).toBe('password');

    await user.type(input, 'x');
    expect(onChange).toHaveBeenLastCalledWith('x');
  });

  it('calling Clear sets the value to null', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <SecretField
        id="test-secret"
        label="Access token"
        masked={{ configured: true, hint: '••••4821' }}
        value={undefined}
        onChange={onChange}
      />,
      { locale: 'en' },
    );

    await user.click(await screen.findByRole('button', { name: 'Clear' }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('cancelling an edit reverts to undefined', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <SecretField
        id="test-secret"
        label="Access token"
        masked={{ configured: true, hint: '••••4821' }}
        value=""
        onChange={onChange}
      />,
      { locale: 'en' },
    );

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('shows "Not configured" when the secret has been cleared (value: null)', async () => {
    renderWithProviders(
      <SecretField
        id="test-secret"
        label="Access token"
        masked={{ configured: true, hint: '••••4821' }}
        value={null}
        onChange={vi.fn()}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('Not configured')).toBeTruthy();
    // A cleared secret shows "Set", not "Clear" again — nothing left to clear.
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });
});
