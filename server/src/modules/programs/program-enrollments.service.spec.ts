import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ProgramEnrollmentStatus } from '@biddaloy/shared';
import { ProgramEnrollmentsService } from './program-enrollments.service';

function fakeManager(repos: Record<string, any>, query: any) {
  return {
    getRepository: vi.fn((entity: any) => repos[entity?.name] ?? repos.ProgramEnrollment),
    query,
  };
}

function uniqueViolation() {
  const err = new QueryFailedError('INSERT', [], new Error('duplicate key'));
  (err as unknown as { code: string }).code = '23505';
  return err;
}

describe('ProgramEnrollmentsService', () => {
  let programRepo: any;
  let milestoneRepo: any;
  let enrollmentRepo: any;
  let achievementRepo: any;
  let studentRepo: any;
  let dataSource: any;
  let auditService: any;
  let queryMock: any;
  let service: ProgramEnrollmentsService;

  const TENANT = 'tenant-1';
  const OTHER_TENANT = 'tenant-2';
  const PROGRAM_ID = 'program-1';

  beforeEach(() => {
    programRepo = { findOne: vi.fn() };
    milestoneRepo = { findOne: vi.fn(), find: vi.fn(async () => []), count: vi.fn(async () => 0) };
    enrollmentRepo = {
      find: vi.fn(async () => []),
      findOne: vi.fn(),
      findOneOrFail: vi.fn(),
      update: vi.fn(async () => ({ affected: 1 })),
    };
    achievementRepo = {
      findOne: vi.fn(),
      find: vi.fn(async () => []),
      createQueryBuilder: vi.fn(),
    };
    studentRepo = { find: vi.fn(async () => []) };
    auditService = { record: vi.fn() };
    queryMock = vi.fn(async () => []);

    dataSource = {
      transaction: vi.fn(async (cb: any) =>
        cb(
          fakeManager(
            {
              ProgramEnrollment: enrollmentRepo,
              MilestoneAchievement: achievementRepo,
            },
            queryMock,
          ),
        ),
      ),
    };

    service = new ProgramEnrollmentsService(
      programRepo,
      milestoneRepo,
      enrollmentRepo,
      achievementRepo,
      studentRepo,
      dataSource,
      auditService,
    );
  });

  describe('enrol', () => {
    it('skips students already ACTIVE (partial unique DO NOTHING) and reports skipped', async () => {
      programRepo.findOne.mockResolvedValue({ id: PROGRAM_ID, tenant_id: TENANT, is_active: true });
      studentRepo.find.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      // Only s1 actually inserted — s2 already had an ACTIVE row and the
      // ON CONFLICT DO NOTHING left it out of RETURNING.
      queryMock.mockResolvedValueOnce([{ id: 'enr-1', student_id: 's1' }]);

      const result = await service.enrol(TENANT, PROGRAM_ID, 'user-1', {
        student_ids: ['s1', 's2'],
      });

      expect(result).toEqual({ created: 1, skipped: 1 });
      expect(auditService.record).toHaveBeenCalledTimes(1);
    });

    it('refuses to enrol into an archived program with a 409', async () => {
      programRepo.findOne.mockResolvedValue({
        id: PROGRAM_ID,
        tenant_id: TENANT,
        is_active: false,
      });
      await expect(
        service.enrol(TENANT, PROGRAM_ID, 'user-1', { student_ids: ['s1'] }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('404s on a cross-tenant student id', async () => {
      programRepo.findOne.mockResolvedValue({ id: PROGRAM_ID, tenant_id: TENANT, is_active: true });
      studentRepo.find.mockResolvedValue([{ id: 's1' }]); // s2 missing (other tenant)
      await expect(
        service.enrol(TENANT, PROGRAM_ID, 'user-1', { student_ids: ['s1', 's2'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404s when the program doesn't exist in this tenant", async () => {
      programRepo.findOne.mockResolvedValue(null);
      await expect(
        service.enrol(OTHER_TENANT, PROGRAM_ID, 'user-1', { student_ids: ['s1'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('sets ended_on when going ACTIVE -> COMPLETED', async () => {
      enrollmentRepo.findOne.mockResolvedValueOnce({
        id: 'enr-1',
        tenant_id: TENANT,
        status: ProgramEnrollmentStatus.ACTIVE,
        ended_on: null,
      });
      enrollmentRepo.findOneOrFail.mockResolvedValue({
        id: 'enr-1',
        status: ProgramEnrollmentStatus.COMPLETED,
        started_on: '2026-01-01',
        ended_on: '2026-09-26',
      });

      const result = await service.updateStatus(TENANT, 'enr-1', 'user-1', {
        status: ProgramEnrollmentStatus.COMPLETED,
        ended_on: '2026-09-26',
      });

      expect(enrollmentRepo.update).toHaveBeenCalledWith(
        { id: 'enr-1', tenant_id: TENANT },
        { status: ProgramEnrollmentStatus.COMPLETED, ended_on: '2026-09-26' },
      );
      expect(result.ended_on).toBe('2026-09-26');
      expect(auditService.record).toHaveBeenCalledTimes(1);
    });

    it('clears ended_on when going back to ACTIVE', async () => {
      enrollmentRepo.findOne.mockResolvedValueOnce({
        id: 'enr-1',
        tenant_id: TENANT,
        status: ProgramEnrollmentStatus.WITHDRAWN,
        ended_on: '2026-01-01',
      });
      enrollmentRepo.findOneOrFail.mockResolvedValue({
        id: 'enr-1',
        status: ProgramEnrollmentStatus.ACTIVE,
        started_on: '2026-01-01',
        ended_on: null,
      });

      await service.updateStatus(TENANT, 'enr-1', 'user-1', {
        status: ProgramEnrollmentStatus.ACTIVE,
      });

      expect(enrollmentRepo.update).toHaveBeenCalledWith(
        { id: 'enr-1', tenant_id: TENANT },
        { status: ProgramEnrollmentStatus.ACTIVE, ended_on: null },
      );
    });

    it('maps a re-activate partial-unique collision to a 409', async () => {
      enrollmentRepo.findOne.mockResolvedValueOnce({
        id: 'enr-1',
        tenant_id: TENANT,
        status: ProgramEnrollmentStatus.WITHDRAWN,
        ended_on: '2026-01-01',
      });
      enrollmentRepo.update.mockRejectedValueOnce(uniqueViolation());

      await expect(
        service.updateStatus(TENANT, 'enr-1', 'user-1', { status: ProgramEnrollmentStatus.ACTIVE }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s on a cross-tenant enrollment id', async () => {
      enrollmentRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.updateStatus(OTHER_TENANT, 'enr-1', 'user-1', {
          status: ProgramEnrollmentStatus.COMPLETED,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('record', () => {
    it('upserts via one INSERT statement (not a loop) and audits per enrolment', async () => {
      programRepo.findOne.mockResolvedValue({ id: PROGRAM_ID, tenant_id: TENANT });
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        program_id: PROGRAM_ID,
        tenant_id: TENANT,
      });
      enrollmentRepo.find.mockResolvedValue([
        { id: 'enr-1', program_id: PROGRAM_ID, tenant_id: TENANT },
        { id: 'enr-2', program_id: PROGRAM_ID, tenant_id: TENANT },
      ]);

      const result = await service.record(TENANT, PROGRAM_ID, 'user-1', {
        enrollment_ids: ['enr-1', 'enr-2'],
        milestone_id: 'm1',
      });

      expect(result).toEqual({ upserted: 2 });
      // Exactly one INSERT statement regardless of enrolment count.
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock.mock.calls[0][0]).toMatch(/ON CONFLICT \(enrollment_id, milestone_id\)/);
      expect(auditService.record).toHaveBeenCalledTimes(2);
    });

    it('second call updates score without changing row count (idempotent upsert)', async () => {
      programRepo.findOne.mockResolvedValue({ id: PROGRAM_ID, tenant_id: TENANT });
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        program_id: PROGRAM_ID,
        tenant_id: TENANT,
      });
      enrollmentRepo.find.mockResolvedValue([
        { id: 'enr-1', program_id: PROGRAM_ID, tenant_id: TENANT },
      ]);

      await service.record(TENANT, PROGRAM_ID, 'user-1', {
        enrollment_ids: ['enr-1'],
        milestone_id: 'm1',
        score: 70,
      });
      const first = await service.record(TENANT, PROGRAM_ID, 'user-1', {
        enrollment_ids: ['enr-1'],
        milestone_id: 'm1',
        score: 95,
      });

      expect(first).toEqual({ upserted: 1 });
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(queryMock.mock.calls[1][1]).toContain(95);
    });

    it('404s when the milestone belongs to a different program', async () => {
      programRepo.findOne.mockResolvedValue({ id: PROGRAM_ID, tenant_id: TENANT });
      milestoneRepo.findOne.mockResolvedValue(null);
      await expect(
        service.record(TENANT, PROGRAM_ID, 'user-1', {
          enrollment_ids: ['enr-1'],
          milestone_id: 'foreign-milestone',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s when an enrolment does not belong to this program+tenant', async () => {
      programRepo.findOne.mockResolvedValue({ id: PROGRAM_ID, tenant_id: TENANT });
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        program_id: PROGRAM_ID,
        tenant_id: TENANT,
      });
      enrollmentRepo.find.mockResolvedValue([]); // requested enrolment not found in scope
      await expect(
        service.record(TENANT, PROGRAM_ID, 'user-1', {
          enrollment_ids: ['enr-foreign'],
          milestone_id: 'm1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removeAchievement', () => {
    it('deletes and audits', async () => {
      achievementRepo.findOne.mockResolvedValue({
        id: 'ach-1',
        tenant_id: TENANT,
        enrollment_id: 'enr-1',
        milestone_id: 'm1',
        achieved_on: '2026-01-01',
      });
      achievementRepo.delete = vi.fn(async () => ({ affected: 1 }));

      await service.removeAchievement(TENANT, 'ach-1', 'user-1');

      expect(achievementRepo.delete).toHaveBeenCalledWith({ id: 'ach-1', tenant_id: TENANT });
      expect(auditService.record).toHaveBeenCalledTimes(1);
    });

    it("404s on another tenant's achievement id", async () => {
      achievementRepo.findOne.mockResolvedValue(null);
      await expect(
        service.removeAchievement(OTHER_TENANT, 'ach-1', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('studentPrograms', () => {
    it('shapes each enrolment with its milestones, achievement or null, and counts', async () => {
      enrollmentRepo.find.mockResolvedValue([
        {
          id: 'enr-1',
          program_id: 'program-1',
          status: ProgramEnrollmentStatus.ACTIVE,
          started_on: '2026-01-01',
          ended_on: null,
          program: {
            id: 'program-1',
            name: 'Hifz Track',
            is_active: true,
            show_on_report_card: true,
          },
        },
      ]);
      milestoneRepo.find.mockResolvedValue([
        { id: 'm1', program_id: 'program-1', name: 'Juz 1', sequence: 1 },
        { id: 'm2', program_id: 'program-1', name: 'Juz 2', sequence: 2 },
      ]);
      achievementRepo.find.mockResolvedValue([
        {
          id: 'ach-1',
          enrollment_id: 'enr-1',
          milestone_id: 'm1',
          achieved_on: '2026-02-01',
          score: '90.00',
          grade: 'A',
          remark: null,
        },
      ]);

      const rows = await service.studentPrograms(TENANT, 'student-1');

      expect(rows).toHaveLength(1);
      expect(rows[0].achieved_count).toBe(1);
      expect(rows[0].milestone_total).toBe(2);
      expect(rows[0].milestones).toEqual([
        {
          id: 'm1',
          name: 'Juz 1',
          sequence: 1,
          achievement: {
            id: 'ach-1',
            achieved_on: '2026-02-01',
            score: '90.00',
            grade: 'A',
            remark: null,
          },
        },
        { id: 'm2', name: 'Juz 2', sequence: 2, achievement: null },
      ]);
    });

    it('returns an empty list for a student with no enrolments', async () => {
      enrollmentRepo.find.mockResolvedValue([]);
      const rows = await service.studentPrograms(TENANT, 'student-1');
      expect(rows).toEqual([]);
    });

    it('handles a zero-milestone program (empty milestones array, zero total)', async () => {
      enrollmentRepo.find.mockResolvedValue([
        {
          id: 'enr-1',
          program_id: 'program-1',
          status: ProgramEnrollmentStatus.ACTIVE,
          started_on: '2026-01-01',
          ended_on: null,
          program: {
            id: 'program-1',
            name: 'No Milestones',
            is_active: true,
            show_on_report_card: false,
          },
        },
      ]);
      milestoneRepo.find.mockResolvedValue([]);
      achievementRepo.find.mockResolvedValue([]);

      const rows = await service.studentPrograms(TENANT, 'student-1');

      expect(rows[0].milestones).toEqual([]);
      expect(rows[0].achieved_count).toBe(0);
      expect(rows[0].milestone_total).toBe(0);
    });
  });
});
