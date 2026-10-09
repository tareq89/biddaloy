import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HomeworkNoticeService } from './homework-notice.service';
import { CommunicationStatus, CommunicationTrigger, CommunicationMedium } from '@biddaloy/shared';

const TENANT = 'tenant-1';

function guardian(overrides: Partial<any> = {}) {
  return {
    id: 'g-1',
    full_name: 'Karim Uddin',
    phone: '01712345678',
    alternate_phone: null,
    email: null,
    is_primary_contact: true,
    notifications_enabled: true,
    preferred_communication: CommunicationMedium.SMS,
    ...overrides,
  };
}

function student(overrides: Partial<any> = {}) {
  return {
    id: 's-1',
    full_name: 'Rahim Uddin',
    guardians: [guardian()],
    ...overrides,
  };
}

const ASSIGNMENT = {
  id: 'assign-1',
  tenant_id: TENANT,
  section_id: 'section-1',
  student_id: null,
  due_date: '2026-01-08',
};

const HOMEWORK = { id: 'hw-1', title: 'Chapter 3 exercises' };

describe('HomeworkNoticeService', () => {
  let studentRepo: any;
  let logRepo: any;
  let queue: any;
  let service: HomeworkNoticeService;

  beforeEach(() => {
    studentRepo = {
      findOne: vi.fn(async () => student()),
      find: vi.fn(async () => [student()]),
    };
    logRepo = {
      create: vi.fn((v) => v),
      save: vi.fn(async (v) => ({ id: 'log-1', ...v })),
      manager: {},
    };
    queue = { add: vi.fn(async () => undefined) };
    service = new HomeworkNoticeService(studentRepo, logRepo, queue);
  });

  describe('notifyAssignment', () => {
    it('creates one AUTOMATED CommunicationLog per guardian for a section target', async () => {
      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);

      expect(studentRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { class_section_id: 'section-1', tenant_id: TENANT },
        }),
      );
      expect(logRepo.save).toHaveBeenCalledTimes(1);
      const saved = logRepo.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        tenant_id: TENANT,
        guardian_id: 'g-1',
        student_id: 's-1',
        trigger: CommunicationTrigger.AUTOMATED,
        status: CommunicationStatus.QUEUED,
      });
      expect(saved.message_body).toContain('Chapter 3 exercises');
      expect(queue.add).toHaveBeenCalledWith('send', { logId: 'log-1' });
    });

    it('notifies the single target student when student_id is set', async () => {
      const single = { ...ASSIGNMENT, section_id: null, student_id: 'student-1' };
      await service.notifyAssignment(single as never, HOMEWORK as never);
      expect(studentRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'student-1', tenant_id: TENANT } }),
      );
      expect(logRepo.save).toHaveBeenCalledTimes(1);
    });

    it('respects opt-out — a guardian with notifications disabled is skipped', async () => {
      studentRepo.find.mockResolvedValue([
        student({ guardians: [guardian({ notifications_enabled: false })] }),
      ]);
      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);
      expect(logRepo.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('skips a guardian with no dispatchable medium', async () => {
      studentRepo.find.mockResolvedValue([
        student({
          guardians: [guardian({ preferred_communication: CommunicationMedium.PHONE_CALL })],
        }),
      ]);
      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);
      expect(logRepo.save).not.toHaveBeenCalled();
    });

    it('does not notify the same guardian twice for two students in the same section', async () => {
      const sharedGuardian = guardian();
      studentRepo.find.mockResolvedValue([
        student({ id: 's-1', guardians: [sharedGuardian] }),
        student({ id: 's-2', guardians: [sharedGuardian] }),
      ]);
      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);
      expect(logRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifyDefaulters', () => {
    it('creates a notice for each defaulting student passed in', async () => {
      await service.notifyDefaulters(ASSIGNMENT as never, HOMEWORK as never, [student()] as never);
      expect(logRepo.save).toHaveBeenCalledTimes(1);
      expect(logRepo.save.mock.calls[0][0].message_body).toContain('has not been submitted yet');
    });

    it('sends nothing for an empty defaulter list', async () => {
      await service.notifyDefaulters(ASSIGNMENT as never, HOMEWORK as never, []);
      expect(logRepo.save).not.toHaveBeenCalled();
    });
  });
});
