import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

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
    const result = await controller.login({ email: 'admin@test.com', password: 'password123' } as any);

    // Login accepts either email or phone; when both are absent it falls back to email first.
    expect(mockAuthService.login).toHaveBeenCalledWith('admin@test.com', 'password123');
    expect(result.access_token).toBe('test-jwt-token');
  });

  it('logs in with phone as the identifier when email is absent', async () => {
    await controller.login({ phone: '+8801700000000', password: 'password123' } as any);

    // Phone must be usable as the identifier when email is not supplied.
    expect(mockAuthService.login).toHaveBeenCalledWith('+8801700000000', 'password123');
  });

  it('throws when neither email nor phone is provided', async () => {
    // A login attempt with no identifier at all must be rejected before AuthService is even called.
    await expect(controller.login({ password: 'password123' } as any)).rejects.toThrow(
      'Email or phone is required',
    );
    expect(mockAuthService.login).not.toHaveBeenCalled();
  });
});
