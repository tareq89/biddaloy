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
});
