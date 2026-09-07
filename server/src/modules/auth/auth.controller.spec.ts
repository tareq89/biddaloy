import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { REFRESH_TOKEN_COOKIE } from './token-cookie';

function fakeRequest(
  overrides: Partial<{
    ip: string;
    userAgent: string;
    cookies: Record<string, string>;
    user: any;
  }> = {},
): any {
  return {
    ip: overrides.ip ?? '127.0.0.1',
    headers: { 'user-agent': overrides.userAgent ?? 'test-agent' },
    cookies: overrides.cookies ?? {},
    user: overrides.user,
  };
}

function fakeResponse() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    setHeader: vi.fn(),
  };
}

const mockIssuedRefreshToken = {
  cookieValue: 'token-id.secret',
  expiresAt: new Date(Date.now() + 60_000),
};

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: any;

  beforeEach(() => {
    mockAuthService = {
      login: vi.fn().mockResolvedValue({
        access_token: 'test-jwt-token',
        memberships: [],
        refreshToken: mockIssuedRefreshToken,
      }),
      refresh: vi.fn().mockResolvedValue({
        access_token: 'new-jwt-token',
        memberships: [],
        refreshToken: mockIssuedRefreshToken,
      }),
      logout: vi.fn().mockResolvedValue(undefined),
      logoutAll: vi.fn().mockResolvedValue(undefined),
      listSessions: vi.fn().mockResolvedValue([]),
      revokeSession: vi.fn().mockResolvedValue(false),
      changePassword: vi.fn().mockResolvedValue({
        access_token: 'post-change-jwt-token',
        memberships: [],
        refreshToken: mockIssuedRefreshToken,
      }),
    };
    controller = new AuthController(mockAuthService as AuthService);
  });

  describe('login', () => {
    it('logs in with email as the identifier and sets the refresh cookie', async () => {
      const response = fakeResponse();
      const result = await controller.login(
        { email: 'admin@test.com', password: 'password123' } as any,
        fakeRequest(),
        response as any,
      );

      // Login accepts either email or phone; when both are absent it falls back to email first.
      expect(mockAuthService.login).toHaveBeenCalledWith('admin@test.com', 'password123', {
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      });
      expect(result.access_token).toBe('test-jwt-token');
      // The refresh token must never appear in the JSON body — only as the httpOnly cookie.
      expect(result).not.toHaveProperty('refreshToken');
      expect(response.cookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        'token-id.secret',
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it('logs in with phone as the identifier when email is absent', async () => {
      const response = fakeResponse();
      await controller.login(
        { phone: '+8801700000000', password: 'password123' } as any,
        fakeRequest(),
        response as any,
      );

      // Phone must be usable as the identifier when email is not supplied.
      expect(mockAuthService.login).toHaveBeenCalledWith('+8801700000000', 'password123', {
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      });
    });

    it('passes null ip/userAgent through when the request lacks them', async () => {
      const response = fakeResponse();
      await controller.login(
        { email: 'admin@test.com', password: 'password123' } as any,
        { ip: undefined, headers: {} } as any,
        response as any,
      );

      expect(mockAuthService.login).toHaveBeenCalledWith('admin@test.com', 'password123', {
        ip: null,
        userAgent: null,
      });
    });

    // A login attempt with no identifier at all is rejected by LoginDto's
    // HasEmailOrPhoneConstraint before this handler ever runs — see
    // login.dto.spec.ts. A directly-constructed controller bypasses the
    // global ValidationPipe, so that rejection can't be exercised here.
  });

  describe('refresh', () => {
    it('reads the cookie, rotates it, and sets the new one', async () => {
      const response = fakeResponse();
      const request = fakeRequest({ cookies: { [REFRESH_TOKEN_COOKIE]: 'old-id.old-secret' } });

      const result = await controller.refresh(request, response as any);

      expect(mockAuthService.refresh).toHaveBeenCalledWith(
        'old-id.old-secret',
        expect.objectContaining({ ip: '127.0.0.1', userAgent: 'test-agent' }),
      );
      expect(result.access_token).toBe('new-jwt-token');
      expect(response.cookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        'token-id.secret',
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it('passes undefined through when no cookie is present', async () => {
      const response = fakeResponse();
      await controller.refresh(fakeRequest({ cookies: {} }), response as any);

      expect(mockAuthService.refresh).toHaveBeenCalledWith(undefined, expect.anything());
    });
  });

  describe('logout', () => {
    it('revokes the cookie and clears it, scoped to the auth path', async () => {
      const response = fakeResponse();
      const request = fakeRequest({ cookies: { [REFRESH_TOKEN_COOKIE]: 'id.secret' } });

      await controller.logout(request, response as any);

      expect(mockAuthService.logout).toHaveBeenCalledWith('id.secret', expect.anything());
      expect(response.clearCookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        expect.objectContaining({ path: '/' }),
      );
    });
  });

  describe('logoutAll', () => {
    it('reads the verified user off the request and revokes everything', async () => {
      const response = fakeResponse();
      const request = fakeRequest({ user: { sub: 'user-1', jti: 'jti-123', memberships: [] } });

      await controller.logoutAll(request, response as any);

      expect(mockAuthService.logoutAll).toHaveBeenCalledWith(
        'user-1',
        'jti-123',
        expect.anything(),
      );
      expect(response.clearCookie).toHaveBeenCalled();
    });
  });
  describe('listSessions', () => {
    it('reads the verified user and cookie, and wraps the result in { data }', async () => {
      const rows = [{ id: 'family-1', current: true } as any];
      mockAuthService.listSessions.mockResolvedValue(rows);
      const request = fakeRequest({
        user: { sub: 'user-1', jti: 'jti-1', memberships: [] },
        cookies: { [REFRESH_TOKEN_COOKIE]: 'id.secret' },
      });

      const result = await controller.listSessions(request, fakeResponse() as any);

      expect(mockAuthService.listSessions).toHaveBeenCalledWith('user-1', 'id.secret');
      expect(result).toEqual({ data: rows });
    });

    it('passes undefined through when no cookie is present (a bare API client)', async () => {
      const request = fakeRequest({ user: { sub: 'user-1', jti: 'jti-1', memberships: [] } });
      const response = fakeResponse();

      await controller.listSessions(request, response as any);

      expect(mockAuthService.listSessions).toHaveBeenCalledWith('user-1', undefined);
    });

    it('sets Cache-Control: no-store, since the response carries device/IP metadata', async () => {
      const request = fakeRequest({ user: { sub: 'user-1', jti: 'jti-1', memberships: [] } });
      const response = fakeResponse();

      await controller.listSessions(request, response as any);

      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });

  describe('revokeSession', () => {
    it('clears the cookie when the revoked family was the current one', async () => {
      mockAuthService.revokeSession.mockResolvedValue(true);
      const response = fakeResponse();
      const request = fakeRequest({
        user: { sub: 'user-1', jti: 'jti-1', memberships: [] },
        cookies: { [REFRESH_TOKEN_COOKIE]: 'id.secret' },
      });

      await controller.revokeSession(
        '11111111-1111-1111-1111-111111111111',
        request,
        response as any,
      );

      expect(mockAuthService.revokeSession).toHaveBeenCalledWith(
        'user-1',
        '11111111-1111-1111-1111-111111111111',
        'id.secret',
        'jti-1',
        expect.anything(),
      );
      expect(response.clearCookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        expect.objectContaining({ path: '/' }),
      );
    });

    it('does not clear the cookie when the revoked family was not the current one', async () => {
      mockAuthService.revokeSession.mockResolvedValue(false);
      const response = fakeResponse();
      const request = fakeRequest({ user: { sub: 'user-1', jti: 'jti-1', memberships: [] } });

      await controller.revokeSession(
        '11111111-1111-1111-1111-111111111111',
        request,
        response as any,
      );

      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('never forwards a client-supplied X-Tenant-ID header — the service resolves tenant_id itself', async () => {
      const response = fakeResponse();
      const request = fakeRequest({ user: { sub: 'user-1', jti: 'jti-1', memberships: [] } });
      request.headers['x-tenant-id'] = 'tenant-1';

      await controller.revokeSession(
        '11111111-1111-1111-1111-111111111111',
        request,
        response as any,
      );

      expect(mockAuthService.revokeSession).toHaveBeenCalledWith(
        'user-1',
        '11111111-1111-1111-1111-111111111111',
        undefined,
        'jti-1',
        expect.anything(),
      );
    });
  });

  describe('changePassword', () => {
    it('acts on the verified caller, sets the fresh cookie, and returns a LoginResponse', async () => {
      const response = fakeResponse();
      const request = fakeRequest({ user: { sub: 'user-1', jti: 'jti-123', memberships: [] } });

      const result = await controller.changePassword(
        { current_password: 'old-pass', new_password: 'new-pass' } as any,
        request,
        response as any,
      );

      // The user id comes from the verified token, never from the body —
      // this is what makes changing someone else's password impossible.
      expect(mockAuthService.changePassword).toHaveBeenCalledWith(
        'user-1',
        { current_password: 'old-pass', new_password: 'new-pass' },
        { ip: '127.0.0.1', userAgent: 'test-agent' },
      );
      // The caller stays signed in: a new refresh cookie is set, not cleared.
      expect(response.cookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        'token-id.secret',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(response.clearCookie).not.toHaveBeenCalled();
      expect(result.access_token).toBe('post-change-jwt-token');
      expect(result).not.toHaveProperty('refreshToken');
    });
  });
});
