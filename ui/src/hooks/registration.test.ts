import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { clearAuthState, getAccessToken } from '../api/auth-state';
import { loginResponseFactory } from '../test/msw/handlers/auth';
import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';

import { resendRegistrationCode, startRegistration, verifyRegistration } from './registration';

afterEach(() => {
  clearAuthState();
});

const START = {
  admin_name: 'Rahim',
  school_name: 'Green Valley',
  country_code: 'BD',
  address: 'Dhaka',
  phone: '01712345678',
  email: 'rahim@example.com',
  terms_accepted: true,
  captcha_token: 'tok',
};

describe('startRegistration', () => {
  it('posts the form and resolves with the staged registration', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/auth/register/start', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ registration_id: 'reg-1', channel: 'sms', resend_in: 60 });
      }),
    );

    await expect(startRegistration(START)).resolves.toMatchObject({ registration_id: 'reg-1' });
    expect(body).toEqual(START);
  });

  it('surfaces the ApiErrorBody shape as an ApiError', async () => {
    server.use(
      http.post('/api/v1/auth/register/start', () =>
        HttpResponse.json(apiErrorBody(409, 'Contact in use', '/api/v1/auth/register/start'), {
          status: 409,
        }),
      ),
    );

    await expect(startRegistration(START)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('resendRegistrationCode', () => {
  it('posts the registration id', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/auth/register/resend', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ registration_id: 'reg-1', channel: 'email', resend_in: 60 });
      }),
    );

    await expect(resendRegistrationCode('reg-1')).resolves.toMatchObject({ channel: 'email' });
    expect(body).toEqual({ registration_id: 'reg-1' });
  });

  it('surfaces 410 (expired) as an ApiError', async () => {
    server.use(
      http.post('/api/v1/auth/register/resend', () =>
        HttpResponse.json(apiErrorBody(410, 'expired', '/api/v1/auth/register/resend'), {
          status: 410,
        }),
      ),
    );

    await expect(resendRegistrationCode('reg-1')).rejects.toMatchObject({ statusCode: 410 });
  });
});

describe('verifyRegistration', () => {
  it('adopts the issued session and returns the password flags', async () => {
    server.use(
      http.post('/api/v1/auth/register/verify', () =>
        HttpResponse.json({
          ...loginResponseFactory({ access_token: 'reg-token' }),
          needs_password: true,
          password_required: true,
        }),
      ),
    );

    const result = await verifyRegistration(new QueryClient(), {
      registration_id: 'reg-1',
      otp: '123456',
    });

    expect(result.password_required).toBe(true);
    expect(getAccessToken()).toBe('reg-token');
  });

  it('surfaces a wrong code as an ApiError without adopting a session', async () => {
    server.use(
      http.post('/api/v1/auth/register/verify', () =>
        HttpResponse.json(apiErrorBody(401, 'Invalid code', '/api/v1/auth/register/verify'), {
          status: 401,
        }),
      ),
    );

    await expect(
      verifyRegistration(new QueryClient(), { registration_id: 'reg-1', otp: '000000' }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(getAccessToken()).toBeNull();
  });
});
