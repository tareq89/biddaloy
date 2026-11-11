import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodeStep } from './code-step';

afterEach(cleanupTestState);

const render = (props: Partial<React.ComponentProps<typeof CodeStep>> = {}) =>
  renderWithProviders(<CodeStep onSubmit={vi.fn()} onStartAgain={vi.fn()} {...props} />, {
    locale: 'en',
  });

describe('CodeStep', () => {
  it('focuses the code field and submits six digits on Enter', async () => {
    const onSubmit = vi.fn();
    render({ onSubmit });
    const field = await screen.findByLabelText('6-digit code from your authenticator app');
    expect(document.activeElement).toBe(field);
    await userEvent.setup().type(field, '123456{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('123456');
  });

  it('does not submit a short code', async () => {
    const onSubmit = vi.fn();
    render({ onSubmit });
    await userEvent
      .setup()
      .type(await screen.findByLabelText('6-digit code from your authenticator app'), '123{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('wrong code: the message sits under the field', async () => {
    render({ error: 'Code did not match, use the new 30-second code.' });
    expect((await screen.findByRole('alert')).textContent).toContain('Code did not match');
  });

  it('the recovery link switches to a 16-character field and back', async () => {
    const onSubmit = vi.fn();
    render({ onSubmit });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Use a recovery code' }));
    const field = screen.getByLabelText('Recovery code');
    expect(document.activeElement).toBe(field);
    await user.type(field, 'abcd-efgh-ijkl-mnop{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('abcdefghijklmnop');
    await user.click(screen.getByRole('button', { name: 'Use the code from the app instead' }));
    expect(screen.getByLabelText('6-digit code from your authenticator app')).toBeTruthy();
  });
});
