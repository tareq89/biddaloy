import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { User } from '../users/entities/user.entity';
import { UserTenant } from './entities/user-tenant.entity';
import { AuditService } from '../audit/audit.service';
import { LoginAttemptService } from './login-attempt.service';
import { RefreshTokenService, RefreshTokenReuseDetectedException } from './refresh-token.service';
import { AccessTokenDenylistService } from './access-token-denylist.service';
import { ACCESS_TOKEN_TTL_MS } from './auth-tokens';
import { AuditAction, UserRole, UserStatus } from '@biddaloy/shared';

// Mock bcrypt as a module-level replacement
// This must be before any imports of bcrypt
vi.mock('bcrypt', () => {
  const mockCompare = vi.fn();
  return {
    default: { compare: mockCompare },
    compare: mockCompare,
  };
});

import bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let mockUserRepo: any;
  let mockUserTenantRepo: any;
  let mockAuditService: any;
  let mockJwtService: any;
  let mockLoginAttempts: any;
  let mockRefreshTokens: any;
  let mockAccessTokenDenylist: any;

  const mockIssuedRefreshToken = {
    cookieValue: 'token-id.token-secret',
    expiresAt: new Date(Date.now() + 60_000),
  };

  const mockUser: User = {
    id: 'user-1',
    email: 'admin@test.com',
    phone: null,
    password_hash: '$2b$10$hashedpassword123',
    full_name: 'Test Admin',
    status: 'ACTIVE' as any,
    profile_picture_url: null,
    preferences: null,
    last_login_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
  };

  const mockMemberships: UserTenant[] = [
    {
      id: 'ut-1',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      role: UserRole.ADMIN,
      metadata: null,
      created_at: new Date(),
      updated_at: new Date(),
      user: undefined as any,
      tenant: { id: 'tenant-1', name: 'Greenview School' } as any,
    },
  ];

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock repositories
    mockUserRepo = {
      findOne: vi.fn(),
      save: vi.fn(),
    };
    mockUserTenantRepo = {
      find: vi.fn(),
      // Backs primaryTenantId()'s "earliest membership" lookup used to
      // attribute an audit row's tenant_id — defaults to the one
      // membership most tests set up via mockUserTenantRepo.find.
      findOne: vi.fn().mockResolvedValue(mockMemberships[0]),
    };
    mockAuditService = {
      record: vi.fn().mockResolvedValue(undefined),
    };

    // Create a mock JwtService with a proper sign method
    mockJwtService = {
      sign: vi.fn().mockReturnValue('test-jwt-token'),
      verify: vi.fn(),
      decode: vi.fn(),
    };

    mockLoginAttempts = {
      isLocked: vi.fn().mockResolvedValue(false),
      recordFailure: vi.fn().mockResolvedValue({ locked: false, delayMs: 0 }),
      reset: vi.fn().mockResolvedValue(undefined),
    };

    mockRefreshTokens = {
      issueForUser: vi.fn().mockResolvedValue(mockIssuedRefreshToken),
      rotate: vi.fn(),
      revokeByCookieValue: vi.fn(),
      revokeAllForUser: vi.fn().mockResolvedValue(undefined),
    };

    mockAccessTokenDenylist = {
      revoke: vi.fn().mockResolvedValue(undefined),
      isRevoked: vi.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(UserTenant), useValue: mockUserTenantRepo },
        { provide: AuditService, useValue: mockAuditService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: LoginAttemptService, useValue: mockLoginAttempts },
        { provide: RefreshTokenService, useValue: mockRefreshTokens },
        { provide: AccessTokenDenylistService, useValue: mockAccessTokenDenylist },
        { provide: ACCESS_TOKEN_TTL_MS, useValue: 900_000 },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('validateUser', () => {
    it('should return user when email and password are valid', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);

      const result = await service.validateUser('admin@test.com', 'password123');

      expect(result).toEqual(mockUser);
      expect(mockUserRepo.findOne).toHaveBeenCalledWith({
        where: [{ email: 'admin@test.com' }, { phone: 'admin@test.com' }],
      });
    });

    it('should return user when phone and password are valid', async () => {
      const phoneUser = { ...mockUser, email: null, phone: '+8801700000000' };
      mockUserRepo.findOne.mockResolvedValue(phoneUser);
      (bcrypt.compare as any).mockResolvedValue(true);

      const result = await service.validateUser('+8801700000000', 'password123');

      expect(result).toEqual(phoneUser);
      expect(mockUserRepo.findOne).toHaveBeenCalledWith({
        where: [{ email: '+8801700000000' }, { phone: '+8801700000000' }],
      });
    });

    // Protects against a timing oracle: without a dummy-hash compare here,
    // "no such user" would return near-instantly while "wrong password"
    // pays bcrypt's cost — a response-time difference that lets an
    // attacker enumerate valid identifiers without ever seeing a
    // different response body.
    it('should still call bcrypt.compare (against a dummy hash) when the user is not found', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      (bcrypt.compare as any).mockResolvedValue(false);

      const result = await service.validateUser('unknown@test.com', 'password123');

      expect(result).toBeNull();
      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'password123',
        expect.stringMatching(/^\$2[aby]\$/),
      );
    });

    it('should return null when password is invalid', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(false);

      const result = await service.validateUser('admin@test.com', 'wrong-password');

      expect(result).toBeNull();
    });

    // Same timing protection as the not-found case, and it must not compare
    // against `null` (bcrypt.compare would reject) — the dummy hash covers it.
    it('should compare against the dummy hash when user has no password_hash', async () => {
      const noPasswordUser = { ...mockUser, password_hash: null };
      mockUserRepo.findOne.mockResolvedValue(noPasswordUser);
      (bcrypt.compare as any).mockResolvedValue(false);

      const result = await service.validateUser('admin@test.com', 'password123');

      expect(result).toBeNull();
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'password123',
        expect.stringMatching(/^\$2[aby]\$/),
      );
    });
  });

  describe('login', () => {
    it('should return access_token and memberships on successful login', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);
      mockUserTenantRepo.find.mockResolvedValue(mockMemberships);
      mockUserRepo.save.mockResolvedValue(mockUser);

      const result = await service.login('admin@test.com', 'password123');

      expect(result.access_token).toBe('test-jwt-token');
      expect(result.memberships).toHaveLength(1);
      expect(result.memberships[0]).toEqual({
        tenantId: 'tenant-1',
        role: UserRole.ADMIN,
        name: 'Greenview School',
      });
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'admin@test.com',
        phone: null,
        memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN, name: 'Greenview School' }],
        jti: expect.any(String),
      });
    });

    // Every login starts a fresh rotation family — see auth.service.ts's
    // comment on why this isn't chained onto any previous session.
    it('issues a refresh token scoped to the logged-in user', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);
      mockUserTenantRepo.find.mockResolvedValue(mockMemberships);
      mockUserRepo.save.mockResolvedValue(mockUser);

      const result = await service.login('admin@test.com', 'password123');

      expect(result.refreshToken).toBe(mockIssuedRefreshToken);
      expect(mockRefreshTokens.issueForUser).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        expect.objectContaining({ ip: null, userAgent: null }),
      );
    });

    it('should throw UnauthorizedException when credentials are invalid', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(service.login('invalid@test.com', 'password123')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.login('invalid@test.com', 'password123')).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('should handle user with no memberships gracefully', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);
      mockUserTenantRepo.find.mockResolvedValue([]);
      mockUserRepo.save.mockResolvedValue(mockUser);

      const result = await service.login('admin@test.com', 'password123');

      expect(result.access_token).toBe('test-jwt-token');
      expect(result.memberships).toEqual([]);
    });

    it('should update last_login_at on successful login', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);
      mockUserTenantRepo.find.mockResolvedValue(mockMemberships);
      mockUserRepo.save.mockResolvedValue({ ...mockUser, last_login_at: new Date() });

      await service.login('admin@test.com', 'password123');

      expect(mockUserRepo.save).toHaveBeenCalled();
      const savedUser = mockUserRepo.save.mock.calls[0][0];
      expect(savedUser.last_login_at).toBeInstanceOf(Date);
    });

    it('resets the attempt counter on a successful login', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);
      mockUserTenantRepo.find.mockResolvedValue(mockMemberships);
      mockUserRepo.save.mockResolvedValue(mockUser);

      await service.login('admin@test.com', 'password123');

      expect(mockLoginAttempts.reset).toHaveBeenCalledWith('admin@test.com');
      expect(mockLoginAttempts.recordFailure).not.toHaveBeenCalled();
    });

    it('normalizes the identifier before checking/recording attempts', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(service.login(' Admin@Test.com ', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockLoginAttempts.isLocked).toHaveBeenCalledWith('admin@test.com');
      expect(mockLoginAttempts.recordFailure).toHaveBeenCalledWith('admin@test.com');
    });

    it('records a failure and writes a LOGIN_FAILED audit row on wrong password', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(false);
      mockLoginAttempts.recordFailure.mockResolvedValue({ locked: false, delayMs: 0 });

      await expect(service.login('admin@test.com', 'wrong-password')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockLoginAttempts.recordFailure).toHaveBeenCalledWith('admin@test.com');
      // entity_id is null here, same as the unknown-identifier case:
      // validateUser returns null for both "no such user" and "wrong
      // password" by design, so the audit row can't distinguish them
      // either — that's the same don't-leak-existence property applied
      // consistently, not a gap. new_values.identifier still lets support
      // search failed attempts by what was typed.
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.LOGIN_FAILED,
          entity_id: null,
          new_values: { identifier: 'admin@test.com' },
        }),
      );
    });

    it('writes a LOGIN audit row on success', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);
      mockUserTenantRepo.find.mockResolvedValue(mockMemberships);
      mockUserRepo.save.mockResolvedValue(mockUser);

      await service.login('admin@test.com', 'password123', { ip: '1.2.3.4', userAgent: 'ua' });

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.LOGIN,
          entity_id: 'user-1',
          ip_address: '1.2.3.4',
          user_agent: 'ua',
        }),
      );
    });

    // primaryTenantId() feeds an audit record, but runs before
    // AuditService.record() ever gets a chance to fail open — a transient
    // error here must not reject login itself (last_login_at is already
    // saved by this point), so it degrades to tenant_id: null instead.
    it('still returns the access token when the tenant lookup for the audit record fails', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);
      mockUserTenantRepo.find.mockResolvedValue(mockMemberships);
      mockUserRepo.save.mockResolvedValue(mockUser);
      mockUserTenantRepo.findOne.mockRejectedValue(new Error('db unavailable'));

      const result = await service.login('admin@test.com', 'password123');

      expect(result.access_token).toBe('test-jwt-token');
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.LOGIN, tenant_id: null }),
      );
    });

    // Rejects with correct credentials once the identifier is locked out —
    // otherwise a lockout would be pointless.
    it('rejects a correct password when the identifier is already locked out', async () => {
      mockLoginAttempts.isLocked.mockResolvedValue(true);
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);

      await expect(service.login('admin@test.com', 'password123')).rejects.toThrow(
        'Invalid credentials',
      );
      expect(mockUserRepo.save).not.toHaveBeenCalled();
    });

    // Once locked, further attempts don't keep extending the lockout window —
    // recordFailure is only called for identifiers that aren't locked yet.
    it('does not call recordFailure again once already locked out', async () => {
      mockLoginAttempts.isLocked.mockResolvedValue(true);
      mockUserRepo.findOne.mockResolvedValue(null);
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(service.login('admin@test.com', 'password123')).rejects.toThrow(
        'Invalid credentials',
      );

      expect(mockLoginAttempts.recordFailure).not.toHaveBeenCalled();
    });

    // Even while locked, validateUser still runs (same bcrypt-timing path
    // as any other failure) — the response shouldn't be faster just
    // because the identifier is locked.
    it('still calls bcrypt.compare when the identifier is already locked out', async () => {
      mockLoginAttempts.isLocked.mockResolvedValue(true);
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);

      await expect(service.login('admin@test.com', 'password123')).rejects.toThrow(
        'Invalid credentials',
      );

      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    });

    // The "audit write failure must not break login" guarantee used to live
    // in this file, back when AuthService caught its own audit errors
    // (writeAuditLog's try/catch). That guarantee now lives in
    // AuditService.record() itself (see audit.service.spec.ts) — AuthService
    // just calls it and trusts the contract, same as every other
    // non-transactional call site.

    // A suspended/inactive account must fail exactly like a wrong password —
    // same status, same message, same LOGIN_FAILED action — otherwise the
    // response itself would leak whether an account exists but is disabled.
    // This also has to hold for login specifically, not just refresh:
    // otherwise a deactivated user could just log back in with their
    // password to route around a suspension instead of being locked out by
    // it, which would make the refresh-side check pointless.
    it('rejects a correct password for a non-ACTIVE user, identically to a wrong password', async () => {
      const suspendedUser = { ...mockUser, status: UserStatus.SUSPENDED };
      mockUserRepo.findOne.mockResolvedValue(suspendedUser);
      (bcrypt.compare as any).mockResolvedValue(true);

      await expect(service.login('admin@test.com', 'password123')).rejects.toThrow(
        'Invalid credentials',
      );
      expect(mockUserRepo.save).not.toHaveBeenCalled();
      expect(mockRefreshTokens.issueForUser).not.toHaveBeenCalled();
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.LOGIN_FAILED }),
      );
    });
  });

  describe('refresh', () => {
    it('throws UnauthorizedException when no cookie is presented', async () => {
      await expect(service.refresh(undefined, { ip: null, userAgent: null })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockRefreshTokens.rotate).not.toHaveBeenCalled();
    });

    it('issues a fresh access token reflecting current memberships, not stale ones', async () => {
      mockRefreshTokens.rotate.mockResolvedValue({
        userId: 'user-1',
        refreshToken: mockIssuedRefreshToken,
      });
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      mockUserTenantRepo.find.mockResolvedValue(mockMemberships);

      const result = await service.refresh('token-id.secret', { ip: null, userAgent: null });

      expect(result.access_token).toBe('test-jwt-token');
      expect(result.memberships).toEqual([
        { tenantId: 'tenant-1', role: UserRole.ADMIN, name: 'Greenview School' },
      ]);
      expect(result.refreshToken).toBe(mockIssuedRefreshToken);
    });

    it('throws when the rotated token belongs to a user that no longer exists', async () => {
      mockRefreshTokens.rotate.mockResolvedValue({
        userId: 'ghost-user',
        refreshToken: mockIssuedRefreshToken,
      });
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(
        service.refresh('token-id.secret', { ip: null, userAgent: null }),
      ).rejects.toThrow(UnauthorizedException);
    });

    // Otherwise a suspension only takes effect once the access token's own
    // ~15-minute lifetime runs out, not "on the next refresh" as the rest
    // of this method's membership-freshness behavior promises.
    it('rejects a rotated token belonging to a non-ACTIVE user, the same as a missing one', async () => {
      mockRefreshTokens.rotate.mockResolvedValue({
        userId: 'user-1',
        refreshToken: mockIssuedRefreshToken,
      });
      mockUserRepo.findOne.mockResolvedValue({ ...mockUser, status: UserStatus.INACTIVE });

      await expect(
        service.refresh('token-id.secret', { ip: null, userAgent: null }),
      ).rejects.toThrow('User no longer exists');
    });

    // The whole point of reuse detection: when it fires, it must be
    // observable, not just a silent 401 — TOKEN_REUSE_DETECTED is what a
    // security team would actually alert on.
    it('writes a TOKEN_REUSE_DETECTED audit row when reuse is detected, then rethrows', async () => {
      mockRefreshTokens.rotate.mockRejectedValue(
        new RefreshTokenReuseDetectedException('user-1', 'family-1'),
      );

      await expect(
        service.refresh('token-id.secret', { ip: '1.2.3.4', userAgent: 'ua' }),
      ).rejects.toThrow('Refresh token reuse detected');

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.TOKEN_REUSE_DETECTED,
          entity_id: 'user-1',
          ip_address: '1.2.3.4',
          user_agent: 'ua',
          new_values: { family_id: 'family-1' },
        }),
      );
    });

    it('propagates a plain UnauthorizedException (expired/invalid token) without writing an audit row', async () => {
      mockRefreshTokens.rotate.mockRejectedValue(
        new UnauthorizedException('Refresh token expired'),
      );

      await expect(
        service.refresh('token-id.secret', { ip: null, userAgent: null }),
      ).rejects.toThrow('Refresh token expired');
      expect(mockAuditService.record).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('is a no-op when no cookie is presented', async () => {
      await service.logout(undefined, { ip: null, userAgent: null });

      expect(mockRefreshTokens.revokeByCookieValue).not.toHaveBeenCalled();
      expect(mockAuditService.record).not.toHaveBeenCalled();
    });

    it('is a no-op when the cookie does not resolve to a live token', async () => {
      mockRefreshTokens.revokeByCookieValue.mockResolvedValue(null);

      await service.logout('token-id.secret', { ip: null, userAgent: null });

      expect(mockAuditService.record).not.toHaveBeenCalled();
    });

    it('revokes the token and writes a LOGOUT audit row', async () => {
      mockRefreshTokens.revokeByCookieValue.mockResolvedValue('user-1');

      await service.logout('token-id.secret', { ip: '1.2.3.4', userAgent: 'ua' });

      expect(mockRefreshTokens.revokeByCookieValue).toHaveBeenCalledWith('token-id.secret');
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.LOGOUT,
          entity_id: 'user-1',
          ip_address: '1.2.3.4',
          user_agent: 'ua',
        }),
      );
    });
  });

  describe('logoutAll', () => {
    it('revokes every refresh token for the user, denylists the current access token, and audits it', async () => {
      await service.logoutAll('user-1', 'jti-123', { ip: '1.2.3.4', userAgent: 'ua' });

      expect(mockRefreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
      expect(mockAccessTokenDenylist.revoke).toHaveBeenCalledWith('jti-123', 900_000);
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.LOGOUT,
          entity_id: 'user-1',
          new_values: { scope: 'all_sessions' },
        }),
      );
    });
  });
});
