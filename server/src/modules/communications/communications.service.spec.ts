import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { CommunicationsService } from './communications.service';
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';

describe('CommunicationsService', () => {
  let service: CommunicationsService;
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let queue: Record<string, ReturnType<typeof vi.fn>>;
  let studentService: Record<string, ReturnType<typeof vi.fn>>;
  let guardianService: Record<string, ReturnType<typeof vi.fn>>;

  const TENANT_ID = 'tenant-1';
  const USER_ID = 'user-1';

  let queryBuilder: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    queryBuilder = {
      distinctOn: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([]),
    };
    repo = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ id: 'log-1', created_at: new Date(), ...data })),
      findOne: vi.fn(),
      find: vi.fn(),
      createQueryBuilder: vi.fn(() => queryBuilder),
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

    it('writes a QUEUED log row stamped with the tenant, and pushes a job onto the queue', async () => {
      const result = await service.enqueue(baseDto as any, TENANT_ID, USER_ID);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT_ID,
          status: CommunicationStatus.QUEUED,
          sent_by_user_id: USER_ID,
        }),
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
      studentService.findOne.mockRejectedValue(
        new NotFoundException('Student with ID "student-1" not found'),
      );

      await expect(
        service.enqueue({ ...baseDto, student_id: 'student-1' } as any, TENANT_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException when guardian_id does not belong to the tenant', async () => {
      guardianService.findOne.mockRejectedValue(
        new NotFoundException('Guardian with ID "guardian-1" not found'),
      );

      await expect(
        service.enqueue({ ...baseDto, guardian_id: 'guardian-1' } as any, TENANT_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('marks the log FAILED and throws when the queue rejects the enqueue', async () => {
      queue.add.mockRejectedValue(new Error('Redis unreachable'));

      await expect(service.enqueue(baseDto as any, TENANT_ID, USER_ID)).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(repo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: CommunicationStatus.FAILED }),
      );
    });
  });

  describe('findOne', () => {
    it('scopes the lookup to the log id and the caller tenant', async () => {
      repo.findOne.mockResolvedValue({
        id: 'log-1',
        tenant_id: TENANT_ID,
        medium: CommunicationMedium.SMS,
        recipient_address: '01712345678',
        recipient_name: 'Guardian',
        status: CommunicationStatus.SENT,
        provider_message_id: 'p-1',
        created_at: new Date(),
      });

      const result = await service.findOne('log-1', TENANT_ID);

      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'log-1', tenant_id: TENANT_ID } });
      expect(result.id).toBe('log-1');
    });

    it('throws NotFoundException when no row matches the id + tenant pair', async () => {
      // The mocked repo mirrors what a real tenant-scoped WHERE would
      // return for a missing row or one belonging to a different tenant —
      // both cases return no match.
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne('log-1', TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByStudent', () => {
    // [8.10.2]'s Communication tab.
    it('scopes the query to the student and the caller tenant, newest first', async () => {
      repo.find.mockResolvedValue([
        {
          id: 'log-2',
          medium: CommunicationMedium.SMS,
          recipient_address: '01712345678',
          recipient_name: 'Guardian',
          status: CommunicationStatus.SENT,
          provider_message_id: null,
          created_at: new Date('2026-02-01'),
        },
      ]);

      const result = await service.findByStudent('student-1', TENANT_ID);

      expect(repo.find).toHaveBeenCalledWith({
        where: { student_id: 'student-1', tenant_id: TENANT_ID },
        order: { created_at: 'DESC' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('log-2');
    });

    it('resolves an empty array for a student nothing has ever been sent to', async () => {
      repo.find.mockResolvedValue([]);

      const result = await service.findByStudent('student-1', TENANT_ID);

      expect(result).toEqual([]);
    });
  });

  describe('findLastReminders', () => {
    // [8.10.4]'s dues queue "Last reminder" column.
    it('returns a map of student_id to the most recent reminder', async () => {
      const sentAt = new Date('2026-03-01');
      queryBuilder.getRawMany.mockResolvedValue([
        { student_id: 'student-1', medium: CommunicationMedium.SMS, sent_at: sentAt },
      ]);

      const result = await service.findLastReminders(['student-1'], TENANT_ID);

      expect(result.get('student-1')).toEqual({ sent_at: sentAt, medium: CommunicationMedium.SMS });
    });

    it('scopes the query to BULK_REMINDER and SINGLE_REMINDER triggers only, excluding MANUAL', async () => {
      await service.findLastReminders(['student-1'], TENANT_ID);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('log.trigger IN (:...triggers)', {
        triggers: [CommunicationTrigger.BULK_REMINDER, CommunicationTrigger.SINGLE_REMINDER],
      });
    });

    it('resolves an empty map without querying when no student IDs are given', async () => {
      const result = await service.findLastReminders([], TENANT_ID);

      expect(result.size).toBe(0);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
