import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnrollmentController } from './enrollments.controller';
import { EnrollmentService } from './enrollments.service';
import { UserRole } from '@beton-boi/shared';

/**
 * Unit tests for EnrollmentController.
 *
 * Verifies each endpoint correctly delegates to the service layer
 * with the right arguments, and errors propagate through unchanged.
 * Guard/decorator behaviour is tested separately in auth specs.
 */

describe('EnrollmentController', () => {
  let controller: EnrollmentController;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  const TENANT = { id: 'tenant-1', role: UserRole.ADMIN };

  beforeEach(() => {
    service = {
      create: vi.fn(),
      findByStudent: vi.fn(),
      update: vi.fn(),
    };
    controller = new EnrollmentController(
      service as unknown as EnrollmentService,
    );
  });

  // ────────────────────────
  //  create
  // ────────────────────────
  describe('create', () => {
    it('should call service.create with dto and tenant id', async () => {
      const dto = {
        student_id: 's1',
        class_id: 'c1',
        section_id: 'sec1',
        academic_year_id: 'ay1',
      };
      const expected = { id: 'e1', ...dto };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto as any, TENANT);

      expect(service.create).toHaveBeenCalledWith(dto, TENANT.id);
      expect(result).toEqual(expected);
    });
  });

  // ────────────────────────
  //  findByStudent
  // ────────────────────────
  describe('findByStudent', () => {
    it('should call service.findByStudent with studentId and tenant id', async () => {
      const expected = [{ id: 'e1', student_id: 's1' }];
      service.findByStudent.mockResolvedValue(expected);

      const result = await controller.findByStudent('s1', TENANT);

      expect(service.findByStudent).toHaveBeenCalledWith('s1', TENANT.id);
      expect(result).toEqual(expected);
    });
  });

  // ────────────────────────
  //  update
  // ────────────────────────
  describe('update', () => {
    it('should call service.update with id, dto, and tenant id', async () => {
      const dto = { enrollment_status: 'INACTIVE' as any };
      const expected = { id: 'e1', enrollment_status: 'INACTIVE' };
      service.update.mockResolvedValue(expected);

      const result = await controller.update('e1', dto as any, TENANT);

      expect(service.update).toHaveBeenCalledWith('e1', dto, TENANT.id);
      expect(result).toEqual(expected);
    });
  });

  // ────────────────────────
  //  Error propagation
  // ────────────────────────
  describe('error propagation', () => {
    it('should propagate NotFoundException from service.create', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      service.create.mockRejectedValue(new NotFoundException('Student not found'));

      await expect(
        controller.create(
          { student_id: 'bad', class_id: 'c1', academic_year_id: 'ay1' } as any,
          TENANT,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate ConflictException from service.create', async () => {
      const { ConflictException } = await import('@nestjs/common');
      service.create.mockRejectedValue(
        new ConflictException('Student is already actively enrolled'),
      );

      await expect(
        controller.create(
          { student_id: 's1', class_id: 'c1', academic_year_id: 'ay1' } as any,
          TENANT,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should propagate NotFoundException from service.update', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      service.update.mockRejectedValue(new NotFoundException('Enrollment not found'));

      await expect(
        controller.update('bad', { enrollment_status: 'INACTIVE' as any }, TENANT),
      ).rejects.toThrow(NotFoundException);
    });
  });
});