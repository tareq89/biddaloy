import { getAccessToken } from '@biddaloy/ui/api';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CockpitSignInCard } from './cockpit-sign-in-card';
import { clearEnrolHandoff, readEnrolHandoff, saveEnrolHandoff } from './enrol-handoff';

afterEach(async () => {
  clearEnrolHandoff();
  await cleanupTestState();
});

const login = (body: unknown, status = 200) =>
  http.post('*/auth/cockpit/login', () => HttpResponse.json(body as object, { status }));

function setup() {
  const onSignedIn = vi.fn();
  const onEnrol = vi.fn();
  renderWithProviders(<CockpitSignInCard onSignedIn={onSignedIn} onEnrol={onEnrol} />, {
    locale: 'en',
  });
  return { onSignedIn, onEnrol, user: userEvent.setup() };
}

async function password(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Email or phone number'), 'owner@example.test');
  await user.type(screen.getByLabelText('Password'), 'secret-pass{Enter}');
}

describe('CockpitSignInCard', () => {
  it('known device: password, then the code, then signed in (token kept)', async () => {
    const { onSignedIn, user } = setup();
    await password(user);
    await user.type(
      await screen.findByLabelText('6-digit code from your authenticator app'),
      '123456{Enter}',
    );
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(getAccessToken()).toBe('cockpit-token');
  });

  it('a failed password shows one generic sentence, whatever the cause', async () => {
    server.use(login({ statusCode: 401, message: 'x' }, 401));
    const { user } = setup();
    await password(user);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Sign-in did not work. Check what you typed and try again.',
    );
  });

  it('a wrong code keeps the code step and says so under the field', async () => {
    server.use(
      http.post('*/auth/cockpit/mfa', () =>
        HttpResponse.json({ statusCode: 401 }, { status: 401 }),
      ),
    );
    const { onSignedIn, user } = setup();
    await password(user);
    await user.type(
      await screen.findByLabelText('6-digit code from your authenticator app'),
      '123456{Enter}',
    );
    expect((await screen.findByRole('alert')).textContent).toContain('Code did not match');
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('new device: both codes with remember ticked, then signed in', async () => {
    let body: unknown;
    server.use(
      login({ step: 'device', deviceToken: 'dev-1' }),
      http.post('*/auth/cockpit/device-otp', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ step: 'done', access_token: 'cockpit-token' });
      }),
    );
    const { onSignedIn, user } = setup();
    await password(user);
    await user.type(await screen.findByLabelText('Code from the SMS'), '111111');
    await user.type(screen.getByLabelText('Code from the email'), '222222{Enter}');
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(body).toEqual({
      deviceToken: 'dev-1',
      smsCode: '111111',
      emailCode: '222222',
      rememberDevice: true,
    });
  });

  it('first set-up: the same layout, then the wizard hand-off and redirect', async () => {
    server.use(login({ step: 'enrol', enrolToken: 'enrol-1' }));
    const { onEnrol, user } = setup();
    await password(user);
    expect(await screen.findByRole('heading', { name: 'Set up two-step sign-in' })).toBeTruthy();
    await user.type(screen.getByLabelText('Code from the SMS'), '111111');
    await user.type(screen.getByLabelText('Code from the email'), '222222{Enter}');
    await waitFor(() => expect(onEnrol).toHaveBeenCalled());
    expect(readEnrolHandoff()).toMatchObject({ enrolToken: 'enrol-1', rememberDevice: true });
  });

  it('start again after the enrol codes clears the hand-off', async () => {
    saveEnrolHandoff({ enrolToken: 'old', otpauthUri: 'x', secret: 'y', rememberDevice: true });
    server.use(login({ step: 'enrol', enrolToken: 'enrol-1' }));
    const { user } = setup();
    await password(user);
    await user.click(await screen.findByRole('button', { name: 'Start again' }));
    expect(readEnrolHandoff()).toBeNull();
  });

  it('start again returns to the password step', async () => {
    const { user } = setup();
    await password(user);
    await user.click(await screen.findByRole('button', { name: 'Start again' }));
    expect(await screen.findByLabelText('Password')).toBeTruthy();
  });
});
