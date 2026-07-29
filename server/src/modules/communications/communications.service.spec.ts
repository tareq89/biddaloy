import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CommunicationsService } from './communications.service';
import { CommunicationMedium, CommunicationStatus } from '@beton-boi/shared';

describe('CommunicationsService', () => {
  let service: CommunicationsService;
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let queue: Record<string, ReturnType<typeof vi.fn>>;
  let studentService: Record<string, ReturnType<typeof vi.fn>>;
  let guardianService: Record<string, ReturnType<typeof vi.fn>>;

  const TENANT_ID = 'tenant-1';
  const USER_ID = 'user-1';

  beforeEach(() => {
    repo = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ id: 'log-1', created_at: new Date(), ...data })),
      findOne: vi.fn(),
    };
    queue = { add: vi.fn() };
    studentService = { findOne: vi.fn() };
    guardianService = { findOne: vi.fn() };

    service = new CommunicationsService(
      repo as any,
      queue as any,
      studentService as any,
      guardianService as any,
    );
  });

  describe('enqueue', () => {
    const baseDto = {
      medium: CommunicationMedium.SMS,
      recipient_address: '01712345678',
      recipient_name: 'Guardian',
      message_body: 'Hello',
    };

    it('writes a QUEUED log row and pushes a job onto the queue', async () => {
      const result = await service.enqueue(baseDto as any, TENANT_ID, USER_ID);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CommunicationStatus.QUEUED, sent_by_user_id: USER_ID }),
      );
      expect(queue.add).toHaveBeenCalledWith('send', { logId: 'log-1' });
      expect(result.id).toBe('log-1');
    });

    it('validates student_id against the tenant before enqueuing', async () => {
      studentService.findOne.mockResolvedValue({ id: 'student-1', tenant_id: TENANT_ID });

      await service.enqueue({ ...baseDto, student_id: 'student-1' } as any, TENANT_ID, USER_ID);

      expect(studentService.findOne).toHaveBeenCalledWith('student-1', TENANT_ID);
    });

    it('propagates NotFoundException when student_id does not belong to the tenant', async () => {
      studentService.findOne.mockRejectedValue(new NotFoundException('Student with ID "student-1" not found'));

      await expect(
        service.enqueue({ ...baseDto, student_id: 'student-1' } as any, TENANT_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException when guardian_id does not belong to the tenant', async () => {
      guardianService.findOne.mockRejectedValue(new NotFoundException('Guardian with ID "guardian-1" not found'));

      await expect(
        service.enqueue({ ...baseDto, guardian_id: 'guardian-1' } as any, TENANT_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the log when its student belongs to the tenant', async () => {
      repo.findOne.mockResolvedValue({
        id: 'log-1',
        medium: CommunicationMedium.SMS,
        recipient_address: '01712345678',
        recipient_name: 'Guardian',
        status: CommunicationStatus.SENT,
        provider_message_id: 'p-1',
        created_at: new Date(),
        student: { tenant_id: TENANT_ID },
        guardian: null,
      });

      const result = await service.findOne('log-1', TENANT_ID);

      expect(result.id).toBe('log-1');
    });

    it('throws NotFoundException when the log does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing', TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the log belongs to a different tenant', async () => {
      repo.findOne.mockResolvedValue({
        id: 'log-1',
        student: { tenant_id: 'other-tenant' },
        guardian: null,
      });

      await expect(service.findOne('log-1', TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
