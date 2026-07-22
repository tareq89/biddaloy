import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserController } from './users.controller';
import { UserService, TeacherService } from './users.service';
import { UserRole } from '@beton-boi/shared';

/**
 * Unit tests for UserController.
 *
 * These tests verify that the controller correctly delegates to the
 * service layer — each endpoint calls the right service method with
 * the right arguments, and the response is passed through unchanged.
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
      const expected = { user: { id: 'u1' }, membership: { id: 'm1' } };
      userService.create.mockResolvedValue(expected);

      const result = await controller.createUser(dto as any, TENANT);

      expect(userService.create).toHaveBeenCalledWith(dto, TENANT.id);
      expect(result).toEqual(expected);
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
      expect(result).toEqual(expected);
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
      expect(result).toEqual(expected);
    });
  });

  // ────────────────────────
  //  removeUser
  // ────────────────────────
  describe('removeUser', () => {
    it('should call userService.remove with id and tenant id', async () => {
      userService.remove.mockResolvedValue(undefined);

      const result = await controller.removeUser('u1', TENANT);

      expect(userService.remove).toHaveBeenCalledWith('u1', TENANT.id);
      expect(result).toBeUndefined();
    });
  });

  // ────────────────────────
  //  createTeacher
  // ────────────────────────
  describe('createTeacher', () => {
    it('should call teacherService.create with dto and tenant id', async () => {
      const dto = { user_id: 'u1', employee_id: 'EMP-001' };
      const expected = { id: 't1', employee_id: 'EMP-001' };
      teacherService.create.mockResolvedValue(expected);

      const result = await controller.createTeacher(dto as any, TENANT);

      expect(teacherService.create).toHaveBeenCalledWith(dto, TENANT.id);
      expect(result).toEqual(expected);
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
      const expected = { id: 't1', employee_id: 'EMP-002' };
      teacherService.update.mockResolvedValue(expected);

      const result = await controller.updateTeacher('t1', dto as any, TENANT);

      expect(teacherService.update).toHaveBeenCalledWith('t1', dto, TENANT.id);
      expect(result).toEqual(expected);
    });
  });

  // ────────────────────────
  //  Service errors propagate through
  // ────────────────────────
  describe('error propagation', () => {
    it('should propagate NotFoundException from userService.findOne', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      userService.findOne.mockRejectedValue(new NotFoundException('User not found'));

      await expect(
        controller.findOneUser('nonexistent', TENANT),
      ).rejects.toThrow(NotFoundException);
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
});