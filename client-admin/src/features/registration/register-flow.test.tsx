/** [13.5.1] Details → code → password → done, MSW-backed. */
import { authHandlers, cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RegisterFlow } from './register-flow';

const START = { registration_id: 'r1', channel: 'sms', resend_in: 60 };
const START_FAST = { ...START, resend_in: 1 };
const VERIFIED = (needsPassword: boolean, passwordRequired: boolean) => ({
  access_token: 'a.b.c',
  memberships: [{ tenantId: 't1', role: 'ADMIN', name: 'School' }],
  needs_password: needsPassword,
  password_required: passwordRequired,
});

function useServer(opts: { start?: () => Response; verify?: () => Response } = {}) {
  const startBodies: unknown[] = [];
  server.use(
    http.get('/api/v1/auth/social/providers', () => HttpResponse.json({ providers: ['google'] })),
    http.post('/api/v1/auth/register/start', async ({ request }) => {
      startBodies.push(await request.json());
      return opts.start ? opts.start() : HttpResponse.json(START);
    }),
    http.post('/api/v1/auth/register/resend', () => HttpResponse.json(START)),
    http.post(
      '/api/v1/auth/register/verify',
      opts.verify ?? (() => HttpResponse.json(VERIFIED(true, true))),
    ),
    http.post('/api/v1/account/first-password', () => new HttpResponse(null, { status: 204 })),
    authHandlers.refreshFailure,
  );
  return startBodies;
}

function errorBody(status: number, details?: object) {
  return HttpResponse.json(
    {
      statusCode: status,
      message: 'RAW SERVER ENGLISH',
      requestId: 'x',
      path: '/x',
      timestamp: 't',
      ...(details ? { details } : {}),
    },
    { status },
  );
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Your name'), 'Rahim Uddin');
  await user.type(screen.getByLabelText('School name'), 'Green Valley School');
  await user.type(screen.getByLabelText('School address'), 'Mirpur, Dhaka');
  await user.type(screen.getByLabelText('Mobile number'), '01712345678');
  await user.type(screen.getByLabelText('Email'), 'rahim@example.com');
  await user.click(screen.getByRole('checkbox'));
}

function setup(onDone = vi.fn()) {
  renderWithProviders(<RegisterFlow onDone={onDone} />, { locale: 'en' });
  return { onDone, user: userEvent.setup() };
}

describe('RegisterFlow', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('runs details → code → password → done', async () => {
    const bodies = useServer();
    const { onDone, user } = setup();
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await user.type(await screen.findByLabelText('Enter the code we sent'), '123456');
    await user.keyboard('{Enter}');

    await user.type(await screen.findByLabelText('New password'), 'A-strong-pass1!');
    await user.type(screen.getByLabelText('Confirm password'), 'A-strong-pass1!');
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(bodies[0]).toMatchObject({
      admin_name: 'Rahim Uddin',
      country_code: 'BD',
      phone: '+8801712345678',
      terms_accepted: true,
      captcha_token: 'no-captcha',
    });
  });

  it('shows "Not now" only when the password is optional', async () => {
    useServer({ verify: () => HttpResponse.json(VERIFIED(true, false)) });
    const { onDone, user } = setup();
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText('Enter the code we sent'), '123456');
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('skips the password step when none is needed', async () => {
    useServer({ verify: () => HttpResponse.json(VERIFIED(false, false)) });
    const { onDone, user } = setup();
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText('Enter the code we sent'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('counts down before a resend, and Change number keeps the values', async () => {
    useServer({ start: () => HttpResponse.json(START_FAST) });
    const { user } = setup();
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const resend = await screen.findByRole('button', { name: /Send again in \d+ s/ });
    expect((resend as HTMLButtonElement).disabled).toBe(true);
    const again = await screen.findByRole(
      'button',
      { name: 'Send the code again' },
      { timeout: 3000 },
    );
    expect((again as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Change number' }));
    expect((await screen.findByLabelText<HTMLInputElement>('Your name')).value).toBe('Rahim Uddin');
    expect(screen.getByLabelText<HTMLInputElement>('Mobile number').value).toBe('01712345678');
  });

  it.each([
    ['start', 409, { code: 'TRIAL_ALREADY_OPEN' }, /trial school already exists/],
    ['start', 503, { code: 'REGISTRATION_UNAVAILABLE' }, /not available right now/],
    ['start', 409, { code: 'CONTACT_IN_USE' }, /already used for another school/],
    ['start', 409, { code: 'SIGN_IN_REQUIRED' }, /already have an account/],
    ['start', 400, undefined, /complete the check/],
    ['verify', 400, undefined, /code is not right/],
    ['verify', 410, undefined, /code has expired/],
    ['verify', 429, undefined, /Too many wrong tries/],
    ['verify', 500, undefined, /Something went wrong/],
  ])(
    '%s %i %j shows its own sentence, never the server text',
    async (where, status, details, re) => {
      const respond = () => errorBody(status, details);
      useServer(where === 'start' ? { start: respond } : { verify: respond });
      const { user } = setup();
      await fillDetails(user);
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      if (where === 'verify') {
        await user.type(await screen.findByLabelText('Enter the code we sent'), '123456');
        await user.keyboard('{Enter}');
      }
      expect((await screen.findByRole('alert')).textContent).toMatch(re);
      expect(screen.queryByText(/RAW SERVER ENGLISH/)).toBeNull();
    },
  );

  it('shows the provider line instead of the buttons when a social ticket is present', async () => {
    useServer();
    renderWithProviders(<RegisterFlow socialTicket={{ provider: 'google' }} onDone={vi.fn()} />, {
      locale: 'en',
    });
    expect(await screen.findByText('Continuing with Google')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).toBeNull();
  });

  it('offers the provider buttons otherwise', async () => {
    useServer();
    setup();
    expect(await screen.findByRole('link', { name: 'Continue with Google' })).toBeTruthy();
  });
});
