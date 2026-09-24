import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  HomeworkAssignmentStatus,
  HomeworkGradingMode,
  HomeworkSubmissionStatus,
  UserRole,
} from '@biddaloy/shared';
import { HomeworkSubmissionService } from './homework-submission.service';

describe('HomeworkSubmissionService', () => {
  const TENANT_ID = '11111111-1111-4111-8111-111111111111';
  const studentCtx = { role: UserRole.STUDENT, userId: 'user-student-1', tenantId: TENANT_ID };
  const teacherCtx = { role: UserRole.TEACHER, userId: 'user-teacher-1', tenantId: TENANT_ID };

  const FUTURE_DUE_DATE = '2999-01-08';
  const PAST_DUE_DATE = '2000-01-08';

  const SECTION_ASSIGNMENT = {
    id: 'assign-1',
    homework_id: 'hw-1',
    section_id: 'section-1',
    student_id: null,
    due_date: FUTURE_DUE_DATE,
    status: HomeworkAssignmentStatus.ACTIVE,
    tenant_id: TENANT_ID,
  };

  const HOMEWORK = {
    id: 'hw-1',
    subject_id: 'subject-1',
    grading_mode: HomeworkGradingMode.TICK,
    tenant_id: TENANT_ID,
  };

  const FILE = {
    originalname: 'answer.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('x'),
  } as Express.Multer.File;

  let homeworkRepo: { findOne: ReturnType<typeof vi.fn> };
  let assignmentRepo: { findOne: ReturnType<typeof vi.fn> };
  let submissionRepo: {
    findOne: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  };
  let studentRepo: { findOne: ReturnType<typeof vi.fn> };
  let access: {
    assertCanManageSection: ReturnType<typeof vi.fn>;
    assertCanManageStudent: ReturnType<typeof vi.fn>;
  };
  let familyAccess: { assertLinked: ReturnType<typeof vi.fn> };
  let storage: { put: ReturnType<typeof vi.fn> };
  let schoolsService: { getResolvedSettings: ReturnType<typeof vi.fn> };
  let service: HomeworkSubmissionService;

  beforeEach(() => {
    homeworkRepo = { findOne: vi.fn(async () => HOMEWORK) };
    assignmentRepo = { findOne: vi.fn(async () => ({ ...SECTION_ASSIGNMENT })) };
    submissionRepo = {
      findOne: vi.fn(async () => null),
      create: vi.fn((v) => ({ status: HomeworkSubmissionStatus.NOT_SUBMITTED, marks: null, ...v })),
      save: vi.fn(async (v) => ({ id: 'sub-1', ...v })),
      find: vi.fn(async () => []),
    };
    studentRepo = {
      findOne: vi.fn(async () => ({
        id: 'student-1',
        class_section_id: 'section-1',
        tenant_id: TENANT_ID,
      })),
    };
    access = {
      assertCanManageSection: vi.fn(async () => undefined),
      assertCanManageStudent: vi.fn(async () => undefined),
    };
    familyAccess = { assertLinked: vi.fn(async () => undefined) };
    storage = { put: vi.fn(async () => undefined) };
    schoolsService = {
      getResolvedSettings: vi.fn(async () => ({ region: { timezone: 'UTC' } })),
    };

    service = new HomeworkSubmissionService(
      homeworkRepo as never,
      assignmentRepo as never,
      submissionRepo as never,
      studentRepo as never,
      access as never,
      familyAccess as never,
      storage as never,
      schoolsService as never,
    );
  });

  describe('upload', () => {
    it('accepts an upload before the due date and marks the submission SUBMITTED', async () => {
      const result = await service.upload('assign-1', 'student-1', [FILE], studentCtx);

      expect(familyAccess.assertLinked).toHaveBeenCalledWith(
        studentCtx.role,
        studentCtx.userId,
        'student-1',
        TENANT_ID,
      );
      expect(storage.put).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(HomeworkSubmissionStatus.SUBMITTED);
      expect(result.attachments).toHaveLength(1);
    });

    it('rejects an upload after the due date', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...SECTION_ASSIGNMENT, due_date: PAST_DUE_DATE });
      await expect(
        service.upload('assign-1', 'student-1', [FILE], studentCtx),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('resubmission replaces attachments while still before the due date', async () => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        assignment_id: 'assign-1',
        student_id: 'student-1',
        status: HomeworkSubmissionStatus.SUBMITTED,
        marks: null,
        attachments: [
          { key: 'old-key', filename: 'old.pdf', mimetype: 'application/pdf', size: 10 },
        ],
        tenant_id: TENANT_ID,
      });

      const newFile = { ...FILE, originalname: 'new-answer.pdf' } as Express.Multer.File;
      const result = await service.upload('assign-1', 'student-1', [newFile], studentCtx);

      expect(result.attachments).toEqual([expect.objectContaining({ filename: 'new-answer.pdf' })]);
    });

    it('does not overwrite a teacher override status back to SUBMITTED (D9)', async () => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        assignment_id: 'assign-1',
        student_id: 'student-1',
        status: HomeworkSubmissionStatus.DONE,
        marks: null,
        attachments: [],
        tenant_id: TENANT_ID,
      });

      const result = await service.upload('assign-1', 'student-1', [FILE], studentCtx);
      expect(result.status).toBe(HomeworkSubmissionStatus.DONE);
    });

    it('rejects when a student uploads for an unlinked student (D26)', async () => {
      familyAccess.assertLinked.mockRejectedValueOnce(new ForbiddenException('not linked'));
      await expect(
        service.upload('assign-1', 'stranger-student', [FILE], studentCtx),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException for an unknown assignment', async () => {
      assignmentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.upload('missing', 'student-1', [FILE], studentCtx),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an upload to a DEACTIVATED assignment', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        ...SECTION_ASSIGNMENT,
        status: HomeworkAssignmentStatus.DEACTIVATED,
      });
      await expect(
        service.upload('assign-1', 'student-1', [FILE], studentCtx),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('evaluates the due-date cutoff in the tenant timezone', async () => {
      schoolsService.getResolvedSettings.mockResolvedValue({
        region: { timezone: 'Asia/Dhaka' },
      });
      await service.upload('assign-1', 'student-1', [FILE], studentCtx);
      expect(schoolsService.getResolvedSettings).toHaveBeenCalledWith(TENANT_ID);
    });
  });

  describe('update (teacher grade/override)', () => {
    beforeEach(() => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        assignment_id: 'assign-1',
        student_id: 'student-1',
        status: HomeworkSubmissionStatus.SUBMITTED,
        marks: null,
        attachments: [],
        tenant_id: TENANT_ID,
      });
    });

    it('sets a teacher override status', async () => {
      const result = await service.update(
        'sub-1',
        { status: HomeworkSubmissionStatus.DONE },
        teacherCtx,
      );
      expect(result.status).toBe(HomeworkSubmissionStatus.DONE);
      expect(access.assertCanManageSection).toHaveBeenCalled();
    });

    it('accepts marks when grading_mode is MARKS', async () => {
      homeworkRepo.findOne.mockResolvedValue({
        ...HOMEWORK,
        grading_mode: HomeworkGradingMode.MARKS,
      });
      const result = await service.update('sub-1', { marks: 8 }, teacherCtx);
      expect(result.marks).toBe(8);
    });

    it('rejects marks when grading_mode is not MARKS', async () => {
      homeworkRepo.findOne.mockResolvedValue({
        ...HOMEWORK,
        grading_mode: HomeworkGradingMode.TICK,
      });
      await expect(service.update('sub-1', { marks: 8 }, teacherCtx)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws NotFoundException for an unknown submission', async () => {
      submissionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('missing', { status: HomeworkSubmissionStatus.DONE }, teacherCtx),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
