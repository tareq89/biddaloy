import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComposeForm, type PreviewState } from './-compose-form';

afterEach(async () => {
  await cleanupTestState();
});

const READY: PreviewState = { kind: 'ready', schools: 4, people: 6 };

async function setup(props: Partial<React.ComponentProps<typeof ComposeForm>> = {}) {
  const onSend = vi.fn();
  const onFilterChange = vi.fn();
  const { localeReady } = renderWithProviders(
    <ComposeForm
      preview={READY}
      onFilterChange={onFilterChange}
      onRetryPreview={() => {}}
      onSend={onSend}
      {...props}
    />,
    { locale: 'en' },
  );
  await localeReady;
  return { onSend, onFilterChange, user: userEvent.setup() };
}

describe('ComposeForm', () => {
  it('asks for the preview of Active schools on mount', async () => {
    const { onFilterChange } = await setup();
    expect(await screen.findByText('Schools: 4. Admins: 6.')).toBeTruthy();
    expect(onFilterChange).toHaveBeenCalledWith(['ACTIVE']);
  });

  it('Send is off until title and message are written', async () => {
    const { user, onSend } = await setup();
    const send = await screen.findByRole('button', { name: 'Send' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Title'), 'Hi');
    expect((send as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Message'), 'Hello');
    expect((send as HTMLButtonElement).disabled).toBe(false);
    await user.click(send);
    expect(onSend).toHaveBeenCalledWith({
      title: 'Hi',
      body: 'Hello',
      severity: 'REMINDER',
      statusFilter: ['ACTIVE'],
      sms: false,
      email: false,
    });
  });

  it('SMS and email are optional, the banner is always on', async () => {
    const { user, onSend } = await setup();
    expect(
      (await screen.findByLabelText('In-app banner (always on)')).getAttribute('data-disabled'),
    ).not.toBeNull();
    await user.type(screen.getByLabelText('Title'), 'Hi');
    await user.type(screen.getByLabelText('Message'), 'Hello');
    await user.click(screen.getByLabelText('SMS'));
    await user.click(screen.getByLabelText('Email'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ sms: true, email: true }));
  });

  it('cannot send when no school matches', async () => {
    const { user } = await setup({ preview: { kind: 'ready', schools: 0, people: 0 } });
    await user.type(await screen.findByLabelText('Title'), 'Hi');
    await user.type(screen.getByLabelText('Message'), 'Hello');
    expect(screen.getByText('No school matches. Nothing will be sent.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send' }).disabled).toBe(true);
  });

  it.each([{ kind: 'loading' }, { kind: 'error' }] as const)(
    'Send is off while the count is $kind',
    async (preview) => {
      const { user, onSend } = await setup({ preview });
      await user.type(await screen.findByLabelText('Title'), 'Hi');
      await user.type(screen.getByLabelText('Message'), 'Hello');
      const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Send' });
      expect(send.disabled).toBe(true);
      await user.click(send);
      expect(onSend).not.toHaveBeenCalled();
    },
  );

  it('error preview offers Count again', async () => {
    const onRetryPreview = vi.fn();
    const { user } = await setup({ preview: { kind: 'error' }, onRetryPreview });
    await user.click(await screen.findByRole('button', { name: 'Count again' }));
    expect(onRetryPreview).toHaveBeenCalled();
  });
});
