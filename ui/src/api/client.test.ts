import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearAuthState, setAccessToken } from './auth-state';
import { deleteAuthSession, fetchPublicVerification, getAuthSessions } from './client';
import { ApiError } from './errors';

/**
 * [12.8] `getAuthSessions`/`deleteAuthSession` bypass `apiClient` (see the
 * functions' own comment in `client.ts`), so they carry their own 401 ->
 * refresh -> retry-once logic rather than inheriting `apiClient`'s
 * interceptor. This file exists to cover that logic directly — it isn't
 * reachable through the interceptor tests that cover `apiClient` itself.
 */
let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(axios);
  setAccessToken('expired-token');
});

afterEach(() => {
  mock.restore();
  clearAuthState();
});

describe('getAuthSessions', () => {
  it('returns the session list on a plain 200', async () => {
    mock.onGet('/api/v1/auth/sessions').reply(200, { data: [] });

    await expect(getAuthSessions()).resolves.toEqual({ data: [] });
  });

  it('retries once through a refresh on a 401, and succeeds with the new token', async () => {
    mock
      .onGet('/api/v1/auth/sessions')
      .replyOnce(401)
      .onPost('/api/v1/auth/refresh')
      .replyOnce(200, { access_token: 'fresh-token', memberships: [] })
      .onGet('/api/v1/auth/sessions')
      .replyOnce(200, { data: [{ id: 's-1' }] });

    await expect(getAuthSessions()).resolves.toEqual({ data: [{ id: 's-1' }] });
  });

  it('normalizes a failed refresh into an ApiError, not a raw AxiosError', async () => {
    mock
      .onGet('/api/v1/auth/sessions')
      .replyOnce(401)
      .onPost('/api/v1/auth/refresh')
      .replyOnce(401, { statusCode: 401, message: 'expired', requestId: 'req-1' });

    await expect(getAuthSessions()).rejects.toBeInstanceOf(ApiError);
  });

  it('normalizes a non-401 failure into an ApiError', async () => {
    mock.onGet('/api/v1/auth/sessions').reply(500, {
      statusCode: 500,
      message: 'boom',
      requestId: 'req-2',
    });

    await expect(getAuthSessions()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('deleteAuthSession', () => {
  it('resolves on a plain 204', async () => {
    mock.onDelete('/api/v1/auth/sessions/s-1').reply(204);

    await expect(deleteAuthSession('s-1')).resolves.toBeUndefined();
  });

  it('retries once through a refresh on a 401, and succeeds with the new token', async () => {
    mock
      .onDelete('/api/v1/auth/sessions/s-1')
      .replyOnce(401)
      .onPost('/api/v1/auth/refresh')
      .replyOnce(200, { access_token: 'fresh-token', memberships: [] })
      .onDelete('/api/v1/auth/sessions/s-1')
      .replyOnce(204);

    await expect(deleteAuthSession('s-1')).resolves.toBeUndefined();
  });

  it('normalizes a failed refresh into an ApiError, not a raw AxiosError', async () => {
    mock
      .onDelete('/api/v1/auth/sessions/s-1')
      .replyOnce(401)
      .onPost('/api/v1/auth/refresh')
      .replyOnce(401, { statusCode: 401, message: 'expired', requestId: 'req-3' });

    await expect(deleteAuthSession('s-1')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('fetchPublicVerification', () => {
  const body = {
    document_kind: 'STUDENT_ID_CARD',
    holder_name: 'Amina Rahman',
    school_name: 'Biddaloy High',
    school_name_bn: null,
    issued_at: '2026-09-01T00:00:00.000Z',
    copy_number: 1,
    status: 'VALID',
  };

  it('returns the public verification for a token, without an abort signal', async () => {
    mock.onGet('/api/v1/public/verify/tok-1').reply(200, body);

    await expect(fetchPublicVerification('tok-1')).resolves.toEqual(body);
  });

  it('passes an abort signal through to the request', async () => {
    mock.onGet('/api/v1/public/verify/tok-1').reply(200, body);
    const controller = new AbortController();

    await fetchPublicVerification('tok-1', controller.signal);

    expect(mock.history.get[0]?.signal).toBe(controller.signal);
  });

  it('URL-encodes the token so it cannot alter the path', async () => {
    mock.onGet('/api/v1/public/verify/a%2Fb%3Fc').reply(200, body);

    await expect(fetchPublicVerification('a/b?c')).resolves.toEqual(body);
  });

  it('normalizes an unknown token (404) into an ApiError', async () => {
    mock.onGet('/api/v1/public/verify/nope').reply(404, {
      statusCode: 404,
      message: 'Not found',
      requestId: 'req-404',
    });

    await expect(fetchPublicVerification('nope')).rejects.toBeInstanceOf(ApiError);
  });

  it('does not send the session token: anyone scanning a printed QR code is logged out', async () => {
    mock.onGet('/api/v1/public/verify/tok-1').reply(200, body);

    await fetchPublicVerification('tok-1');

    expect(mock.history.get[0]?.headers?.Authorization).toBeUndefined();
  });
});
