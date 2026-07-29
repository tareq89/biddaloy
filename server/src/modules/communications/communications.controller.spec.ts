import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { CommunicationMedium, UserRole } from '@beton-boi/shared';

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

  const TENANT = { id: 'tenant-1', role: UserRole.ADMIN };
  const USER = { sub: 'user-1', memberships: [] } as any;

  beforeEach(() => {
    service = { enqueue: vi.fn(), findOne: vi.fn() };
    controller = new CommunicationsController(service as unknown as CommunicationsService);
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
      service.findOne.mockRejectedValue(new NotFoundException('Communication log with ID "bad" not found'));

      await expect(controller.findOne('bad', TENANT)).rejects.toThrow(NotFoundException);
    });
  });
});
