import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FirstPasswordStep } from './first-password-step';

afterEach(async () => {
  await cleanupTestState();
});

async function submit(): Promise<void> {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('New password'), 'A-strong-pass1!');
  await user.type(screen.getByLabelText('Confirm password'), 'A-strong-pass1!');
  await user.click(screen.getByRole('button', { name: 'Set password' }));
}

describe('FirstPasswordStep', () => {
  it('staff: five rules, no skip, saves and finishes', async () => {
    const onDone = vi.fn();
    server.use(
      http.post('/api/v1/account/first-password', () => new HttpResponse(null, { status: 204 })),
    );
    renderWithProviders(
      <FirstPasswordStep roles={[UserRole.TEACHER]} passwordRequired onDone={onDone} />,
      { locale: 'en', tenantId: 'tenant-1' },
    );

    await submit();

    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('family: two rules, and skip finishes without saving', async () => {
    const onDone = vi.fn();
    renderWithProviders(
      <FirstPasswordStep roles={[UserRole.PARENT]} passwordRequired={false} onDone={onDone} />,
      { locale: 'en', tenantId: 'tenant-1' },
    );

    await screen.findByLabelText('New password');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a 409 (password already set elsewhere) just continues', async () => {
    const onDone = vi.fn();
    server.use(
      http.post('/api/v1/account/first-password', () =>
        HttpResponse.json({ statusCode: 409, message: 'exists', requestId: 'r1' }, { status: 409 }),
      ),
    );
    renderWithProviders(
      <FirstPasswordStep roles={[UserRole.ADMIN]} passwordRequired onDone={onDone} />,
      { locale: 'en', tenantId: 'tenant-1' },
    );

    await submit();

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
