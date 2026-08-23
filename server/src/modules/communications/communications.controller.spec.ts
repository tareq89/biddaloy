import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { BulkReminderService } from './reminders.service';
import { SingleReminderService } from './single-reminder.service';
import { CommunicationMedium, UserRole } from '@biddaloy/shared';

/**
 * Unit tests for CommunicationsController.
 *
 * Verifies each endpoint correctly delegates to the service layer with the
 * right arguments, and errors propagate through unchanged. Guard/decorator
 * behaviour (@Roles, ContextGuard's X-Tenant-ID handling) is tested
 * separately in auth specs, matching the convention used by the other
 * controller specs in this codebase (see EnrollmentController/UserController).
 */

describe('CommunicationsController', () => {
  let controller: CommunicationsController;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let bulkReminderService: Record<string, ReturnType<typeof vi.fn>>;
  let singleReminderService: Record<string, ReturnType<typeof vi.fn>>;

  const TENANT = { id: 'tenant-1', role: UserRole.ADMIN };
  const USER = { sub: 'user-1', memberships: [] } as any;
  const REQUEST = { ip: '1.2.3.4', headers: { 'user-agent': 'test-agent' } } as any;
  const REQUEST_CONTEXT = { ip: '1.2.3.4', userAgent: 'test-agent' };

  beforeEach(() => {
    service = { enqueue: vi.fn(), findOne: vi.fn(), findByStudent: vi.fn() };
    bulkReminderService = { sendBulk: vi.fn(), findBatch: vi.fn() };
    singleReminderService = { preview: vi.fn(), sendSingle: vi.fn() };
    controller = new CommunicationsController(
      service as unknown as CommunicationsService,
      bulkReminderService as unknown as BulkReminderService,
      singleReminderService as unknown as SingleReminderService,
    );
  });

  describe('send', () => {
    it('should call service.enqueue with dto, tenant id, and user id', async () => {
      const dto = {
        medium: CommunicationMedium.SMS,
        recipient_address: '01712345678',
        recipient_name: 'Guardian',
        message_body: 'Hello',
      };
      const expected = { id: 'log-1', ...dto };
      service.enqueue.mockResolvedValue(expected);

      const result = await controller.send(dto as any, TENANT, USER);

      expect(service.enqueue).toHaveBeenCalledWith(dto, TENANT.id, USER.sub);
      expect(result).toEqual(expected);
    });
  });

  describe('findOne', () => {
    it('should call service.findOne with id and tenant id', async () => {
      const expected = { id: 'log-1', status: 'SENT' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('log-1', TENANT);

      expect(service.findOne).toHaveBeenCalledWith('log-1', TENANT.id);
      expect(result).toEqual(expected);
    });
  });

  describe('error propagation', () => {
    it('should propagate NotFoundException from service.enqueue', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      service.enqueue.mockRejectedValue(new NotFoundException('Student with ID "bad" not found'));

      await expect(
        controller.send(
          {
            medium: CommunicationMedium.SMS,
            recipient_address: '01712345678',
            recipient_name: 'Guardian',
            message_body: 'Hello',
            student_id: 'bad',
          } as any,
          TENANT,
          USER,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate NotFoundException from service.findOne', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      service.findOne.mockRejectedValue(
        new NotFoundException('Communication log with ID "bad" not found'),
      );

      await expect(controller.findOne('bad', TENANT)).rejects.toThrow(NotFoundException);
    });

    it('should propagate BadRequestException from bulkReminderService.sendBulk', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      bulkReminderService.sendBulk.mockRejectedValue(
        new BadRequestException('Unsupported template placeholder(s): parent'),
      );

      await expect(
        controller.sendBulkReminder(
          { student_ids: ['s-1'], message_template: '{{parent}}' } as any,
          TENANT,
          USER,
          REQUEST,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendBulkReminder', () => {
    it('should call bulkReminderService.sendBulk with dto, tenant id, user id, and request context', async () => {
      const dto = { student_ids: ['s-1'], message_template: 'Dear {{guardian_name}}' };
      const expected = { id: 'batch-1', total_recipients: 1 };
      bulkReminderService.sendBulk.mockResolvedValue(expected);

      const result = await controller.sendBulkReminder(dto as any, TENANT, USER, REQUEST);

      expect(bulkReminderService.sendBulk).toHaveBeenCalledWith(
        dto,
        TENANT.id,
        USER.sub,
        REQUEST_CONTEXT,
      );
      expect(result).toEqual(expected);
    });
  });

  describe('findReminderBatch', () => {
    it('should call bulkReminderService.findBatch with id and tenant id', async () => {
      const expected = { id: 'batch-1', status: 'COMPLETED' };
      bulkReminderService.findBatch.mockResolvedValue(expected);

      const result = await controller.findReminderBatch('batch-1', TENANT);

      expect(bulkReminderService.findBatch).toHaveBeenCalledWith('batch-1', TENANT.id);
      expect(result).toEqual(expected);
    });

    it('should propagate NotFoundException for a batch in another tenant', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      bulkReminderService.findBatch.mockRejectedValue(new NotFoundException('not found'));

      await expect(controller.findReminderBatch('batch-1', TENANT)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('previewSingleReminder', () => {
    it('should call singleReminderService.preview with studentId, dto, and tenant id', async () => {
      const dto = { message_template: 'Dear {{guardian_name}}' };
      const expected = { student_id: 's-1', recipients: [], skipped: [] };
      singleReminderService.preview.mockResolvedValue(expected);

      const result = await controller.previewSingleReminder('s-1', dto as any, TENANT);

      expect(singleReminderService.preview).toHaveBeenCalledWith('s-1', dto, TENANT.id);
      expect(result).toEqual(expected);
    });

    it('should propagate BadRequestException from singleReminderService.preview', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      singleReminderService.preview.mockRejectedValue(new BadRequestException('no open dues'));

      await expect(
        controller.previewSingleReminder('s-1', { message_template: 'Hi' } as any, TENANT),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendSingleReminder', () => {
    it('should call singleReminderService.sendSingle with studentId, dto, tenant id, user id, and request context', async () => {
      const dto = { message_template: 'Dear {{guardian_name}}' };
      const expected = { student_id: 's-1', sent: [], skipped: [] };
      singleReminderService.sendSingle.mockResolvedValue(expected);

      const result = await controller.sendSingleReminder('s-1', dto as any, TENANT, USER, REQUEST);

      expect(singleReminderService.sendSingle).toHaveBeenCalledWith(
        's-1',
        dto,
        TENANT.id,
        USER.sub,
        REQUEST_CONTEXT,
      );
      expect(result).toEqual(expected);
    });

    it('should propagate NotFoundException from singleReminderService.sendSingle', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      singleReminderService.sendSingle.mockRejectedValue(new NotFoundException('not found'));

      await expect(
        controller.sendSingleReminder(
          's-1',
          { message_template: 'Hi' } as any,
          TENANT,
          USER,
          REQUEST,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByStudent', () => {
    it('should call service.findByStudent with student id and tenant id', async () => {
      const expected = [{ id: 'log-1', recipient_name: 'Guardian' }];
      service.findByStudent.mockResolvedValue(expected);

      const result = await controller.findByStudent('student-1', TENANT);

      expect(service.findByStudent).toHaveBeenCalledWith('student-1', TENANT.id);
      expect(result).toEqual(expected);
    });
  });
});
