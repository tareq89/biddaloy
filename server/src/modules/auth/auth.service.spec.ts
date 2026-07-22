import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { User } from '../users/entities/user.entity';
import { UserTenant } from './entities/user-tenant.entity';
import { UserRole } from '@beton-boi/shared';

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
  let mockJwtService: any;

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

    // Create a mock JwtService with a proper sign method
    mockJwtService = {
      sign: vi.fn().mockReturnValue('test-jwt-token'),
      verify: vi.fn(),
      decode: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(UserTenant), useValue: mockUserTenantRepo },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    // Debug: check what's injected
    const injectedJwt = (service as any).jwtService;
    if (!injectedJwt) {
      // Try getting it from the module context
      const jwtFromModule = module.get<JwtService>(JwtService);
      if (jwtFromModule) {
        // Manually assign if DI didn't work
        (service as any).jwtService = jwtFromModule;
      }
    }
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

    it('should return null when user is not found', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      const result = await service.validateUser('unknown@test.com', 'password123');

      expect(result).toBeNull();
    });

    it('should return null when password is invalid', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(false);

      const result = await service.validateUser('admin@test.com', 'wrong-password');

      expect(result).toBeNull();
    });

    it('should return null when user has no password_hash', async () => {
      const noPasswordUser = { ...mockUser, password_hash: null };
      mockUserRepo.findOne.mockResolvedValue(noPasswordUser);

      const result = await service.validateUser('admin@test.com', 'password123');

      expect(result).toBeNull();
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
  });
});