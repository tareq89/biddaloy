import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

function fakeRequest(overrides: Partial<{ ip: string; userAgent: string }> = {}): any {
  return {
    ip: overrides.ip ?? '127.0.0.1',
    headers: { 'user-agent': overrides.userAgent ?? 'test-agent' },
  };
}

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: any;

  beforeEach(() => {
    mockAuthService = {
      login: vi.fn().mockResolvedValue({ access_token: 'test-jwt-token', memberships: [] }),
    };
    controller = new AuthController(mockAuthService as AuthService);
  });

  it('logs in with email as the identifier', async () => {
    const result = await controller.login({ email: 'admin@test.com', password: 'password123' } as any, fakeRequest());

    // Login accepts either email or phone; when both are absent it falls back to email first.
    expect(mockAuthService.login).toHaveBeenCalledWith('admin@test.com', 'password123', {
      ip: '127.0.0.1',
      userAgent: 'test-agent',
    });
    expect(result.access_token).toBe('test-jwt-token');
  });

  it('logs in with phone as the identifier when email is absent', async () => {
    await controller.login({ phone: '+8801700000000', password: 'password123' } as any, fakeRequest());

    // Phone must be usable as the identifier when email is not supplied.
    expect(mockAuthService.login).toHaveBeenCalledWith('+8801700000000', 'password123', {
      ip: '127.0.0.1',
      userAgent: 'test-agent',
    });
  });

  it('passes null ip/userAgent through when the request lacks them', async () => {
    await controller.login(
      { email: 'admin@test.com', password: 'password123' } as any,
      { ip: undefined, headers: {} } as any,
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
