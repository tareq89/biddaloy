import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeviceStep } from './device-step';

afterEach(cleanupTestState);

async function fill(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Code from the SMS'), '111111');
  await user.type(screen.getByLabelText('Code from the email'), '222222');
  return user;
}

describe('DeviceStep', () => {
  it('remember is ticked by default and goes out with both codes', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<DeviceStep mode="device" onSubmit={onSubmit} onStartAgain={vi.fn()} />, {
      locale: 'en',
    });
    expect(
      (await screen.findByRole('checkbox', { name: 'Remember this device' })).getAttribute(
        'data-state',
      ),
    ).toBe('checked');
    expect(document.activeElement).toBe(screen.getByLabelText('Code from the SMS'));
    const user = await fill();
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({
      smsCode: '111111',
      emailCode: '222222',
      rememberDevice: true,
    });
  });

  it('unticking sends rememberDevice false', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<DeviceStep mode="device" onSubmit={onSubmit} onStartAgain={vi.fn()} />, {
      locale: 'en',
    });
    const user = await fill();
    await user.click(screen.getByRole('checkbox', { name: 'Remember this device' }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSubmit.mock.calls[0]?.[0].rememberDevice).toBe(false);
  });

  it('a wrong code shows under the field, and enrol mode has its own heading', async () => {
    renderWithProviders(
      <DeviceStep
        mode="enrol"
        error="A code did not match."
        onSubmit={vi.fn()}
        onStartAgain={vi.fn()}
      />,
      { locale: 'en' },
    );
    expect(await screen.findByRole('heading', { name: 'Set up two-step sign-in' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('A code did not match.');
  });
});
