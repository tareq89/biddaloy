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
    renderWithProviders(
      <SecretField
        id="test-secret"
        label="Access token"
        masked={undefined}
        value={undefined}
        onChange={vi.fn()}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('Not configured')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set' })).toBeTruthy();
  });

  it('shows "Configured" with no hint when configured but the value is too short to hint at', async () => {
    renderWithProviders(
      <SecretField
        id="test-secret"
        label="Access token"
        masked={{ configured: true }}
        value={undefined}
        onChange={vi.fn()}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('Configured')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy();
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

  it('switches to an editable input when Replace is clicked, without submitting anything until typed', async () => {
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

    // Entering editing mode with nothing typed must not touch onChange —
    // an untouched edit box should stay indistinguishable from never
    // having clicked Replace at all (see the component's own comment on
    // why '' used to leak into the PATCH body here).
    expect(onChange).not.toHaveBeenCalled();
    expect(await screen.findByLabelText('Access token')).toBeTruthy();
  });

  it('renders an editable password input and reports typed values via onChange', async () => {
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
    const input = await screen.findByLabelText('Access token');
    expect(input).toHaveProperty('type', 'password');

    await user.type(input, 'x');
    expect(onChange).toHaveBeenLastCalledWith('x');
  });

  it('deleting everything typed reports undefined, not an empty string', async () => {
    const onChange = vi.fn();
    const { user, rerender } = renderWithProviders(
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
    const input = await screen.findByLabelText('Access token');
    await user.type(input, 'x');
    expect(onChange).toHaveBeenLastCalledWith('x');

    // Reflect the typed value back in, then delete it — the box goes
    // back to empty, and onChange must report that as "nothing to
    // submit," the same as never having typed anything.
    rerender(
      <SecretField
        id="test-secret"
        label="Access token"
        masked={{ configured: true, hint: '••••4821' }}
        value="x"
        onChange={onChange}
      />,
    );
    await user.type(await screen.findByLabelText('Access token'), '{Backspace}');

    expect(onChange).toHaveBeenLastCalledWith(undefined);
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
        value={undefined}
        onChange={onChange}
      />,
      { locale: 'en' },
    );

    await user.click(await screen.findByRole('button', { name: 'Replace' }));
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
