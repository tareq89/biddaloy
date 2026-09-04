import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, ConflictException, NotFoundException } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { UserRole } from '@biddaloy/shared';

/**
 * Unit tests for AttendanceController.
 *
 * Verifies each of the six routes delegates to AttendanceService with the
 * right arguments, and that service errors propagate through unchanged.
 * `@Roles`/guard behaviour is tested via the e2e suite, not here.
 */

describe('AttendanceController', () => {
  let controller: AttendanceController;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  const TENANT = { id: 'tenant-1', role: UserRole.TEACHER };
  const USER = { sub: 'user-1' };
  const req = { ip: '10.0.0.1', headers: { 'user-agent': 'jest' } } as any;

  beforeEach(() => {
    service = {
      listMySections: vi.fn(),
      getRegister: vi.fn(),
      putRegister: vi.fn(),
      finalize: vi.fn(),
      correctRecord: vi.fn(),
      getRecordHistory: vi.fn(),
    };
    controller = new AttendanceController(service as unknown as AttendanceService);
  });

  describe('listMySections', () => {
    it('delegates to service.listMySections with role, user, tenant, and date', async () => {
      const expected = [{ id: 'sec-1' }];
      service.listMySections.mockResolvedValue(expected);

      const result = await controller.listMySections({ date: '2026-01-01' } as any, TENANT, USER);

      expect(service.listMySections).toHaveBeenCalledWith({
        role: TENANT.role,
        userId: USER.sub,
        tenantId: TENANT.id,
        date: '2026-01-01',
      });
      expect(result).toEqual(expected);
    });
  });

  describe('getRegister', () => {
    it('delegates to service.getRegister with section, date, period, tenant, role, user', async () => {
      const expected = { section: { id: 'sec-1' } };
      service.getRegister.mockResolvedValue(expected);

      const result = await controller.getRegister(
        'sec-1',
        { date: '2026-01-01', period_no: 2 } as any,
        TENANT,
        USER,
      );

      expect(service.getRegister).toHaveBeenCalledWith({
        sectionId: 'sec-1',
        date: '2026-01-01',
        periodNo: 2,
        tenantId: TENANT.id,
        role: TENANT.role,
        userId: USER.sub,
      });
      expect(result).toEqual(expected);
    });

    it('defaults periodNo to null when not provided', async () => {
      service.getRegister.mockResolvedValue({});

      await controller.getRegister('sec-1', { date: '2026-01-01' } as any, TENANT, USER);

      expect(service.getRegister).toHaveBeenCalledWith(expect.objectContaining({ periodNo: null }));
    });

    it('propagates ForbiddenException from service.getRegister', async () => {
      service.getRegister.mockRejectedValue(new ForbiddenException('no access'));

      await expect(
        controller.getRegister('sec-1', { date: '2026-01-01' } as any, TENANT, USER),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('putRegister', () => {
    it('delegates to service.putRegister with sectionId, dto, tenant, role, user, ip, user-agent', async () => {
      const dto = { date: '2026-01-01', base_version: 0, client_request_id: 'r1', entries: [] };
      const expected = { section: { id: 'sec-1' } };
      service.putRegister.mockResolvedValue(expected);

      const result = await controller.putRegister('sec-1', dto as any, TENANT, USER, req);

      expect(service.putRegister).toHaveBeenCalledWith({
        sectionId: 'sec-1',
        dto,
        tenantId: TENANT.id,
        role: TENANT.role,
        userId: USER.sub,
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
      expect(result).toEqual(expected);
    });

    it('propagates ConflictException from service.putRegister', async () => {
      service.putRegister.mockRejectedValue(new ConflictException('stale version'));

      await expect(
        controller.putRegister(
          'sec-1',
          { date: '2026-01-01', base_version: 0, client_request_id: 'r1', entries: [] } as any,
          TENANT,
          USER,
          req,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('finalize', () => {
    it('delegates to service.finalize with sectionId, date, period, tenant, role, user, ip, user-agent', async () => {
      const dto = { date: '2026-01-01', period_no: 1 };
      const expected = { section: { id: 'sec-1' } };
      service.finalize.mockResolvedValue(expected);

      const result = await controller.finalize('sec-1', dto as any, TENANT, USER, req);

      expect(service.finalize).toHaveBeenCalledWith({
        sectionId: 'sec-1',
        date: '2026-01-01',
        periodNo: 1,
        tenantId: TENANT.id,
        role: TENANT.role,
        userId: USER.sub,
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
      expect(result).toEqual(expected);
    });

    it('propagates NotFoundException from service.finalize', async () => {
      service.finalize.mockRejectedValue(new NotFoundException('no register'));

      await expect(
        controller.finalize('sec-1', { date: '2026-01-01' } as any, TENANT, USER, req),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('correctRecord', () => {
    it('delegates to service.correctRecord with recordId, dto, tenant, role, user, ip, user-agent', async () => {
      const dto = { status: 'PRESENT', reason: 'Marked absent by mistake' };
      const expected = { id: 'rec-1' };
      service.correctRecord.mockResolvedValue(expected);

      const result = await controller.correctRecord('rec-1', dto as any, TENANT, USER, req);

      expect(service.correctRecord).toHaveBeenCalledWith({
        recordId: 'rec-1',
        dto,
        tenantId: TENANT.id,
        role: TENANT.role,
        userId: USER.sub,
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
      expect(result).toEqual(expected);
    });

    it('propagates ForbiddenException from service.correctRecord', async () => {
      service.correctRecord.mockRejectedValue(new ForbiddenException('outside window'));

      await expect(
        controller.correctRecord(
          'rec-1',
          { status: 'PRESENT', reason: 'x' } as any,
          TENANT,
          USER,
          req,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getRecordHistory', () => {
    it('delegates to service.getRecordHistory with recordId, query, tenant, role, user', async () => {
      const query = { page: 1 };
      const expected = { items: [] };
      service.getRecordHistory.mockResolvedValue(expected);

      const result = await controller.getRecordHistory('rec-1', query as any, TENANT, USER);

      expect(service.getRecordHistory).toHaveBeenCalledWith({
        recordId: 'rec-1',
        query,
        tenantId: TENANT.id,
        role: TENANT.role,
        userId: USER.sub,
      });
      expect(result).toEqual(expected);
    });

    it('propagates NotFoundException from service.getRecordHistory', async () => {
      service.getRecordHistory.mockRejectedValue(new NotFoundException('record not found'));

      await expect(controller.getRecordHistory('bad', {} as any, TENANT, USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
