import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserController } from './users.controller';
import { UserService, TeacherService } from './users.service';
import { UserRole } from '@biddaloy/shared';
import { SETTINGS_RATE_LIMIT, STRICT_RATE_LIMIT } from '../../rate-limit';

// @nestjs/throttler does not re-export these from its entrypoint; the values
// are the ones `@Throttle()` writes (throttler.constants.ts).
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';

/**
 * Unit tests for UserController.
 *
 * These tests verify that the controller correctly delegates to the
 * service layer — each endpoint calls the right service method with the
 * right arguments. The response is NOT passed through unchanged: every
 * endpoint that returns a User (directly, or nested under Teacher.user)
 * strips `password_hash` at this boundary — see the "does not leak
 * password_hash" tests below. UserService itself still returns the full
 * entity; that's what the login flow needs.
 *
 * Decorator/guard behavior (@Roles, @UseGuards) is tested separately
 * in auth/decorators/decorators.spec.ts and auth/guards/context.guard.spec.ts.
 */

describe('UserController', () => {
  let controller: UserController;
  let userService: Record<string, ReturnType<typeof vi.fn>>;
  let teacherService: Record<string, ReturnType<typeof vi.fn>>;

  const TENANT = { id: 'tenant-1', role: UserRole.ADMIN };

  beforeEach(() => {
    userService = {
      create: vi.fn(),
      findAll: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    teacherService = {
      create: vi.fn(),
      findAll: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
    };
    controller = new UserController(
      userService as unknown as UserService,
      teacherService as unknown as TeacherService,
    );
  });

  // ────────────────────────
  //  createUser
  // ────────────────────────
  describe('createUser', () => {
    it('should call userService.create with dto and tenant id', async () => {
      const dto = { full_name: 'John', email: 'john@test.com', role: UserRole.TEACHER };
      const expected = {
        user: { id: 'u1' },
        membership: { id: 'm1', role: UserRole.TEACHER },
      };
      userService.create.mockResolvedValue(expected);

      const result = await controller.createUser(dto as any, TENANT);

      expect(userService.create).toHaveBeenCalledWith(dto, TENANT.id);
      // The created entity has no user_tenants relation loaded, so the
      // controller copies the role from the membership it just created.
      expect(result).toEqual({
        user: { id: 'u1', role: UserRole.TEACHER },
        membership: { id: 'm1', role: UserRole.TEACHER },
      });
    });
  });

  // ────────────────────────
  //  findAllUsers
  // ────────────────────────
  describe('findAllUsers', () => {
    it('should call userService.findAll with query and tenant id', async () => {
      const query = { page: 1, limit: 10, role: UserRole.TEACHER };
      const expected = { data: [], total: 0, page: 1, limit: 10, totalPages: 0 };
      userService.findAll.mockResolvedValue(expected);

      const result = await controller.findAllUsers(query as any, TENANT);

      expect(userService.findAll).toHaveBeenCalledWith(query, TENANT.id);
      expect(result).toEqual(expected);
    });
  });

  // ────────────────────────
  //  findOneUser
  // ────────────────────────
  describe('findOneUser', () => {
    it('should call userService.findOne with id and tenant id', async () => {
      const expected = { id: 'u1', full_name: 'John' };
      userService.findOne.mockResolvedValue(expected);

      const result = await controller.findOneUser('u1', TENANT);

      expect(userService.findOne).toHaveBeenCalledWith('u1', TENANT.id);
      expect(result).toEqual({ ...expected, role: null, member_since: null });
    });
  });

  // ────────────────────────
  //  updateUser
  // ────────────────────────
  describe('updateUser', () => {
    it('should call userService.update with id, dto, and tenant id', async () => {
      const dto = { full_name: 'Updated' };
      const expected = { id: 'u1', full_name: 'Updated' };
      userService.update.mockResolvedValue(expected);

      const result = await controller.updateUser('u1', dto as any, TENANT);

      expect(userService.update).toHaveBeenCalledWith('u1', dto, TENANT.id);
      expect(result).toEqual({ ...expected, role: null, member_since: null });
    });
  });

  // ────────────────────────
  //  removeUser
  // ────────────────────────
  describe('removeUser', () => {
    // The service needs the requester's id to refuse self-removal, so the
    // controller must forward `user.sub` from the JWT.
    const JWT = { sub: 'requester-1', email: null, phone: null, memberships: [] };

    it('should call userService.remove with id, tenant id, and requesting user id', async () => {
      userService.remove.mockResolvedValue(undefined);

      const result = await controller.removeUser('u1', TENANT, JWT);

      expect(userService.remove).toHaveBeenCalledWith('u1', TENANT.id, JWT.sub);
      expect(result).toBeUndefined();
    });
  });

  // ────────────────────────
  //  createTeacher
  // ────────────────────────
  describe('createTeacher', () => {
    it('should call teacherService.create with dto and tenant id', async () => {
      const dto = { user_id: 'u1', employee_id: 'EMP-001' };
      // Teacher.user is non-nullable — findOne/create always request the
      // relation — so a realistic mock always includes it.
      const serviceResult = {
        id: 't1',
        employee_id: 'EMP-001',
        user: { id: 'u1', full_name: 'Jane' },
      };
      teacherService.create.mockResolvedValue(serviceResult);

      const result = await controller.createTeacher(dto as any, TENANT);

      expect(teacherService.create).toHaveBeenCalledWith(dto, TENANT.id);
      expect(result.id).toBe('t1');
      expect(result.employee_id).toBe('EMP-001');
      expect(result.user.id).toBe('u1');
    });
  });

  // ────────────────────────
  //  findAllTeachers
  // ────────────────────────
  describe('findAllTeachers', () => {
    it('should call teacherService.findAll with query and tenant id', async () => {
      const query = { page: 1, limit: 10, search: 'Alice' };
      const expected = { data: [], total: 0, page: 1, limit: 10, totalPages: 0 };
      teacherService.findAll.mockResolvedValue(expected);

      const result = await controller.findAllTeachers(query as any, TENANT);

      expect(teacherService.findAll).toHaveBeenCalledWith(query, TENANT.id);
      expect(result).toEqual(expected);
    });
  });

  // ────────────────────────
  //  updateTeacher
  // ────────────────────────
  describe('updateTeacher', () => {
    it('should call teacherService.update with id, dto, and tenant id', async () => {
      const dto = { employee_id: 'EMP-002' };
      const serviceResult = {
        id: 't1',
        employee_id: 'EMP-002',
        user: { id: 'u1', full_name: 'Jane' },
      };
      teacherService.update.mockResolvedValue(serviceResult);

      const result = await controller.updateTeacher('t1', dto as any, TENANT);

      expect(teacherService.update).toHaveBeenCalledWith('t1', dto, TENANT.id);
      expect(result.id).toBe('t1');
      expect(result.employee_id).toBe('EMP-002');
      expect(result.user.id).toBe('u1');
    });
  });

  // ────────────────────────
  //  password_hash never reaches a response
  // ────────────────────────
  // UserService/TeacherService return the full entity (the login flow needs
  // the hash); the controller is the boundary where it must be stripped.
  // These construct the mock service response WITH password_hash set, so a
  // regression that starts passing entities through unchanged fails loudly.
  describe('password_hash is never returned to the client', () => {
    it('strips it from createUser', async () => {
      userService.create.mockResolvedValue({
        user: { id: 'u1', full_name: 'John', password_hash: '$2b$10$secret' },
        membership: { id: 'm1' },
      });

      const result = await controller.createUser({ full_name: 'John' } as any, TENANT);

      expect(result.user).not.toHaveProperty('password_hash');
    });

    it('strips it from every row in findAllUsers', async () => {
      userService.findAll.mockResolvedValue({
        data: [{ id: 'u1', full_name: 'John', password_hash: '$2b$10$secret' }],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });

      const result = await controller.findAllUsers({} as any, TENANT);

      expect(result.data[0]).not.toHaveProperty('password_hash');
    });

    it('strips it from findOneUser', async () => {
      userService.findOne.mockResolvedValue({
        id: 'u1',
        full_name: 'John',
        password_hash: '$2b$10$secret',
      });

      const result = await controller.findOneUser('u1', TENANT);

      expect(result).not.toHaveProperty('password_hash');
    });

    it('strips it from updateUser', async () => {
      userService.update.mockResolvedValue({
        id: 'u1',
        full_name: 'Updated',
        password_hash: '$2b$10$secret',
      });

      const result = await controller.updateUser('u1', {} as any, TENANT);

      expect(result).not.toHaveProperty('password_hash');
    });

    it('strips it from the nested user in createTeacher', async () => {
      teacherService.create.mockResolvedValue({
        id: 't1',
        user: { id: 'u1', full_name: 'John', password_hash: '$2b$10$secret' },
      });

      const result = await controller.createTeacher({} as any, TENANT);

      expect((result as any).user).not.toHaveProperty('password_hash');
    });

    it('strips it from the nested user in every row of findAllTeachers', async () => {
      teacherService.findAll.mockResolvedValue({
        data: [{ id: 't1', user: { id: 'u1', full_name: 'John', password_hash: '$2b$10$secret' } }],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });

      const result = await controller.findAllTeachers({} as any, TENANT);

      expect((result.data[0] as any).user).not.toHaveProperty('password_hash');
    });

    it('strips it from the nested user in updateTeacher', async () => {
      teacherService.update.mockResolvedValue({
        id: 't1',
        user: { id: 'u1', full_name: 'John', password_hash: '$2b$10$secret' },
      });

      const result = await controller.updateTeacher('t1', {} as any, TENANT);

      expect((result as any).user).not.toHaveProperty('password_hash');
    });
  });

  // ────────────────────────
  //  Service errors propagate through
  // ────────────────────────
  describe('error propagation', () => {
    it('should propagate NotFoundException from userService.findOne', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      userService.findOne.mockRejectedValue(new NotFoundException('User not found'));

      await expect(controller.findOneUser('nonexistent', TENANT)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should propagate ConflictException from userService.create', async () => {
      const { ConflictException } = await import('@nestjs/common');
      userService.create.mockRejectedValue(new ConflictException('Email already exists'));

      await expect(
        controller.createUser(
          { full_name: 'John', email: 'dup@test.com', role: UserRole.TEACHER } as any,
          TENANT,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
  // ────────────────────────
  //  rate limiting
  // ────────────────────────
  describe('PATCH /users/me throttling', () => {
    // The 409 this route returns is an account-existence oracle over a
    // GLOBALLY unique column. The status code cannot be hidden — it is the
    // signal the profile form needs — so the rate of probing is what has to
    // be capped. SETTINGS_RATE_LIMIT (20/60s) is the documented tier for
    // "probing-sensitive but cheap"; STRICT_RATE_LIMIT is reserved for
    // genuinely expensive endpoints. Metadata is asserted rather than
    // behaviour because app.module.ts skips throttling entirely when
    // NODE_ENV === 'test'. [5.4a]
    it('carries an explicit @Throttle of SETTINGS_RATE_LIMIT', () => {
      const handler = UserController.prototype.updateMe;

      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(
        SETTINGS_RATE_LIMIT.limit,
      );
      expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(SETTINGS_RATE_LIMIT.ttl);
    });

    it('uses the SETTINGS tier, not the STRICT tier reserved for expensive endpoints', () => {
      const limit: unknown = Reflect.getMetadata(
        `${THROTTLER_LIMIT}default`,
        UserController.prototype.updateMe,
      );
      expect(limit).toBe(20);
      expect(limit).not.toBe(STRICT_RATE_LIMIT.limit);
    });
  });
});
