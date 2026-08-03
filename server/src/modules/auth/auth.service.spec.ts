import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { User } from '../users/entities/user.entity';
import { UserTenant } from './entities/user-tenant.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { LoginAttemptService } from './login-attempt.service';
import { AuditAction, UserRole } from '@beton-boi/shared';

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
  let mockAuditLogRepo: any;
  let mockJwtService: any;
  let mockLoginAttempts: any;

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
      tenant: undefined as any,
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
    };
    mockAuditLogRepo = {
      create: vi.fn((x) => x),
      save: vi.fn().mockResolvedValue(undefined),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(UserTenant), useValue: mockUserTenantRepo },
        { provide: getRepositoryToken(AuditLog), useValue: mockAuditLogRepo },
        { provide: JwtService, useValue: mockJwtService },
        { provide: LoginAttemptService, useValue: mockLoginAttempts },
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
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', expect.stringMatching(/^\$2[aby]\$/));
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
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', expect.stringMatching(/^\$2[aby]\$/));
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
      });
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'admin@test.com',
        phone: null,
        memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN }],
      });
    });

    it('should throw UnauthorizedException when credentials are invalid', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(
        service.login('invalid@test.com', 'password123'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.login('invalid@test.com', 'password123'),
      ).rejects.toThrow('Invalid credentials');
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

      await expect(service.login(' Admin@Test.com ', 'wrong')).rejects.toThrow(UnauthorizedException);

      expect(mockLoginAttempts.isLocked).toHaveBeenCalledWith('admin@test.com');
      expect(mockLoginAttempts.recordFailure).toHaveBeenCalledWith('admin@test.com');
    });

    it('records a failure and writes a LOGIN_FAILED audit row on wrong password', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(false);
      mockLoginAttempts.recordFailure.mockResolvedValue({ locked: false, delayMs: 0 });

      await expect(service.login('admin@test.com', 'wrong-password')).rejects.toThrow(UnauthorizedException);

      expect(mockLoginAttempts.recordFailure).toHaveBeenCalledWith('admin@test.com');
      // entity_id is null here, same as the unknown-identifier case:
      // validateUser returns null for both "no such user" and "wrong
      // password" by design, so the audit row can't distinguish them
      // either — that's the same don't-leak-existence property applied
      // consistently, not a gap. new_values.identifier still lets support
      // search failed attempts by what was typed.
      expect(mockAuditLogRepo.save).toHaveBeenCalledWith(
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

      expect(mockAuditLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.LOGIN,
          entity_id: 'user-1',
          ip_address: '1.2.3.4',
          user_agent: 'ua',
        }),
      );
    });

    // Rejects with correct credentials once the identifier is locked out —
    // otherwise a lockout would be pointless.
    it('rejects a correct password when the identifier is already locked out', async () => {
      mockLoginAttempts.isLocked.mockResolvedValue(true);
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);

      await expect(service.login('admin@test.com', 'password123')).rejects.toThrow('Invalid credentials');
      expect(mockUserRepo.save).not.toHaveBeenCalled();
    });

    // Once locked, further attempts don't keep extending the lockout window —
    // recordFailure is only called for identifiers that aren't locked yet.
    it('does not call recordFailure again once already locked out', async () => {
      mockLoginAttempts.isLocked.mockResolvedValue(true);
      mockUserRepo.findOne.mockResolvedValue(null);
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(service.login('admin@test.com', 'password123')).rejects.toThrow('Invalid credentials');

      expect(mockLoginAttempts.recordFailure).not.toHaveBeenCalled();
    });

    // Even while locked, validateUser still runs (same bcrypt-timing path
    // as any other failure) — the response shouldn't be faster just
    // because the identifier is locked.
    it('still calls bcrypt.compare when the identifier is already locked out', async () => {
      mockLoginAttempts.isLocked.mockResolvedValue(true);
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);

      await expect(service.login('admin@test.com', 'password123')).rejects.toThrow('Invalid credentials');

      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    });

    // Audit logging is ancillary to authentication — a write failure here
    // must never surface as a 500 in place of the real UnauthorizedException,
    // and must never block a successful login from returning its token.
    it('still throws UnauthorizedException (not the audit error) when the audit write fails on a failed login', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      (bcrypt.compare as any).mockResolvedValue(false);
      mockAuditLogRepo.save.mockRejectedValue(new Error('db unavailable'));

      await expect(service.login('admin@test.com', 'wrong-password')).rejects.toThrow(UnauthorizedException);
      await expect(service.login('admin@test.com', 'wrong-password')).rejects.toThrow('Invalid credentials');
    });

    it('still returns the access token when the audit write fails on a successful login', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);
      mockUserTenantRepo.find.mockResolvedValue(mockMemberships);
      mockUserRepo.save.mockResolvedValue(mockUser);
      mockAuditLogRepo.save.mockRejectedValue(new Error('db unavailable'));

      const result = await service.login('admin@test.com', 'password123');

      expect(result.access_token).toBe('test-jwt-token');
    });
  });
});
