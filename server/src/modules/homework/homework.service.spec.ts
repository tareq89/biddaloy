import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { HomeworkAssignmentStatus, HomeworkGradingMode, UserRole } from '@biddaloy/shared';
import { HomeworkService } from './homework.service';
import { attentionEvents } from '../attention/attention.constants';
import { ATTENTION_RECHECK } from '../attention/engine/attention-events';

describe('HomeworkService', () => {
  const TENANT_ID = 'tenant-1';
  const ctx = { role: UserRole.TEACHER, userId: 'user-1', tenantId: TENANT_ID };

  let homeworkRepo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };
  let assignmentRepo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    manager: { transaction: ReturnType<typeof vi.fn> };
  };
  let access: {
    assertCanManageClass: ReturnType<typeof vi.fn>;
    assertCanManageSection: ReturnType<typeof vi.fn>;
    assertCanManageStudent: ReturnType<typeof vi.fn>;
    assertClassAndSubjectInTenant: ReturnType<typeof vi.fn>;
    assertTargetInClass: ReturnType<typeof vi.fn>;
  };
  let notice: { notifyAssignment: ReturnType<typeof vi.fn> };
  let service: HomeworkService;

  const HOMEWORK = {
    id: 'hw-1',
    subject_id: 'subject-1',
    class_id: 'class-1',
    tenant_id: TENANT_ID,
  };

  beforeEach(() => {
    homeworkRepo = {
      create: vi.fn((v) => v),
      save: vi.fn(async (v) => ({ id: 'hw-1', ...v })),
      findOne: vi.fn(async () => HOMEWORK),
      createQueryBuilder: vi.fn(),
    };
    let nextAssignmentId = 0;
    assignmentRepo = {
      create: vi.fn((v) => v),
      // Simulates the DB assigning a fresh id on insert (no `id` on the
      // entity yet) while preserving the id on an update to an existing row.
      save: vi.fn(async (v) => (v.id ? v : { id: `new-assign-${++nextAssignmentId}`, ...v })),
      findOne: vi.fn(),
      // `reassign`'s conditional supersede — 1 affected row by default
      // (the happy path); tests exercising the "already superseded"/race
      // case override this to return 0.
      update: vi.fn(async () => ({ affected: 1 })),
      manager: {
        // `reassign` runs both writes through `manager.getRepository(...)`
        // inside a transaction — reuse this same repo's create/save/update
        // mocks so assertions written against `assignmentRepo.save` etc.
        // still see the calls made through the transaction.
        transaction: vi.fn((fn: (manager: unknown) => unknown) =>
          fn({ getRepository: () => assignmentRepo }),
        ),
      },
    };
    access = {
      assertCanManageClass: vi.fn(async () => undefined),
      assertCanManageSection: vi.fn(async () => undefined),
      assertCanManageStudent: vi.fn(async () => undefined),
      assertClassAndSubjectInTenant: vi.fn(async () => undefined),
      assertTargetInClass: vi.fn(async () => undefined),
      // Skips findOne's section-scope query; that gate is covered against a real
      // DB in homework.controller.e2e-spec.ts (section A vs section B).
      canManageTenantWide: vi.fn(() => true),
    };
    notice = { notifyAssignment: vi.fn(async () => undefined) };
    service = new HomeworkService(
      homeworkRepo as never,
      assignmentRepo as never,
      access as never,
      notice as never,
    );
  });

  describe('create', () => {
    it('creates a Homework scoped to the tenant', async () => {
      const dto = {
        subject_id: 'subject-1',
        class_id: 'class-1',
        title: 'Chapter 3 exercises',
        grading_mode: HomeworkGradingMode.MARKS,
      };
      const result = await service.create(dto, ctx);
      expect(access.assertCanManageClass).toHaveBeenCalledWith(
        ctx.role,
        ctx.userId,
        'class-1',
        'subject-1',
        TENANT_ID,
      );
      expect(homeworkRepo.save).toHaveBeenCalled();
      expect(result).toMatchObject({ title: 'Chapter 3 exercises', tenant_id: TENANT_ID });
    });

    it('propagates ForbiddenException from the access gate', async () => {
      access.assertCanManageClass.mockRejectedValueOnce(new Error('forbidden'));
      const dto = {
        subject_id: 'subject-1',
        class_id: 'class-1',
        title: 'x',
        grading_mode: HomeworkGradingMode.MARKS,
      };
      await expect(service.create(dto, ctx)).rejects.toThrow('forbidden');
    });
  });

  describe('assign', () => {
    it('creates an ACTIVE assignment for a section target', async () => {
      const dto = { section_id: 'section-1', assigned_date: '2026-01-01', due_date: '2026-01-08' };
      const result = await service.assign('hw-1', dto, ctx);
      expect(access.assertCanManageSection).toHaveBeenCalledWith(
        ctx.role,
        ctx.userId,
        'section-1',
        HOMEWORK.subject_id,
        TENANT_ID,
      );
      expect(result).toMatchObject({
        status: HomeworkAssignmentStatus.ACTIVE,
        section_id: 'section-1',
      });
      // [22.3.3] Assignment triggers a guardian notice with the saved
      // assignment row and its parent homework.
      expect(notice.notifyAssignment).toHaveBeenCalledWith(result, HOMEWORK);
    });

    it('does not fail the assignment when the notice send throws', async () => {
      notice.notifyAssignment.mockRejectedValueOnce(new Error('sms provider down'));
      const dto = { section_id: 'section-1', assigned_date: '2026-01-01', due_date: '2026-01-08' };
      const result = await service.assign('hw-1', dto, ctx);
      expect(result).toMatchObject({ status: HomeworkAssignmentStatus.ACTIVE });
    });

    it('rejects both section_id and student_id given together (D24)', async () => {
      const dto = {
        section_id: 'section-1',
        student_id: 'student-1',
        assigned_date: '2026-01-01',
        due_date: '2026-01-08',
      };
      await expect(service.assign('hw-1', dto, ctx)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects neither section_id nor student_id given', async () => {
      const dto = { assigned_date: '2026-01-01', due_date: '2026-01-08' };
      await expect(service.assign('hw-1', dto, ctx)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the homework does not exist', async () => {
      homeworkRepo.findOne.mockResolvedValue(null);
      const dto = { section_id: 'section-1', assigned_date: '2026-01-01', due_date: '2026-01-08' };
      await expect(service.assign('missing', dto, ctx)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a due_date earlier than assigned_date', async () => {
      const dto = { section_id: 'section-1', assigned_date: '2026-01-08', due_date: '2026-01-01' };
      await expect(service.assign('hw-1', dto, ctx)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('checks the target belongs to the homework class', async () => {
      const dto = { section_id: 'section-1', assigned_date: '2026-01-01', due_date: '2026-01-08' };
      await service.assign('hw-1', dto, ctx);
      expect(access.assertTargetInClass).toHaveBeenCalledWith(
        'section-1',
        undefined,
        HOMEWORK.class_id,
        TENANT_ID,
      );
    });
  });

  describe('reassign', () => {
    const OLD_ASSIGNMENT = {
      id: 'assign-1',
      homework_id: 'hw-1',
      section_id: 'section-1',
      student_id: null,
      status: HomeworkAssignmentStatus.ACTIVE,
      tenant_id: TENANT_ID,
    };

    it('creates a new ACTIVE row and marks the old row SUPERSEDED (D20)', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...OLD_ASSIGNMENT });
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };

      const result = await service.reassign('assign-1', dto, ctx);

      // A new row was created and saved with ACTIVE status.
      expect(result).toMatchObject({
        status: HomeworkAssignmentStatus.ACTIVE,
        section_id: 'section-2',
      });
      expect(result.id).not.toBe('assign-1');

      // The old row was superseded via a conditional UPDATE, not left ACTIVE.
      expect(assignmentRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'assign-1' }),
        { status: HomeworkAssignmentStatus.SUPERSEDED },
      );
    });

    it('aborts when the old row was already superseded concurrently (0 rows affected)', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...OLD_ASSIGNMENT });
      assignmentRepo.update.mockResolvedValueOnce({ affected: 0 });
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };

      await expect(service.reassign('assign-1', dto, ctx)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the old assignment does not exist', async () => {
      assignmentRepo.findOne.mockResolvedValue(null);
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('missing', dto, ctx)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects reassigning an already-SUPERSEDED row', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        ...OLD_ASSIGNMENT,
        status: HomeworkAssignmentStatus.SUPERSEDED,
      });
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('assign-1', dto, ctx)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    // Rule 23: a teacher outside the old target gets the same 404 whether the row is live,
    // superseded or missing: no 400-vs-404 or text oracle.
    it('maps an out-of-scope homework to the one fixed 404 text', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...OLD_ASSIGNMENT });
      access.assertCanManageClass.mockRejectedValueOnce(
        new NotFoundException('You do not have access to this class'),
      );
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('assign-1', dto, ctx)).rejects.toThrow(
        new NotFoundException('Homework assignment not found'),
      );
    });

    it('maps an out-of-scope old target to the one fixed 404 text', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...OLD_ASSIGNMENT });
      access.assertCanManageSection.mockRejectedValueOnce(
        new NotFoundException('You do not have access to this section'),
      );
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('assign-1', dto, ctx)).rejects.toThrow(
        new NotFoundException('Homework assignment not found'),
      );
    });

    it('a SUPERSEDED row out of scope is a 404, not the superseded 400', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        ...OLD_ASSIGNMENT,
        status: HomeworkAssignmentStatus.SUPERSEDED,
      });
      access.assertCanManageSection.mockRejectedValueOnce(
        new NotFoundException('You do not have access to this section'),
      );
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('assign-1', dto, ctx)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('checks access to the OLD target before creating the new row (IDOR)', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...OLD_ASSIGNMENT });
      access.assertCanManageSection.mockRejectedValueOnce(new Error('forbidden'));
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('assign-1', dto, ctx)).rejects.toThrow('forbidden');
      // The old target's section (section-1) was checked, not just the new one.
      expect(access.assertCanManageSection).toHaveBeenCalledWith(
        ctx.role,
        ctx.userId,
        'section-1',
        HOMEWORK.subject_id,
        TENANT_ID,
      );
    });
  });

  describe('updateAssignment', () => {
    it('deactivates an ACTIVE assignment', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        id: 'assign-1',
        homework_id: 'hw-1',
        section_id: 'section-1',
        student_id: null,
        status: HomeworkAssignmentStatus.ACTIVE,
        tenant_id: TENANT_ID,
      });
      const result = await service.updateAssignment(
        'assign-1',
        { status: HomeworkAssignmentStatus.DEACTIVATED },
        ctx,
      );
      expect(result.status).toBe(HomeworkAssignmentStatus.DEACTIVATED);
    });

    const activeRow = () => ({
      id: 'assign-1',
      homework_id: 'hw-1',
      section_id: 'section-1',
      student_id: null,
      assigned_date: '2026-01-01',
      due_date: '2026-01-10',
      status: HomeworkAssignmentStatus.ACTIVE,
      tenant_id: TENANT_ID,
    });

    it('moves the due date in place and keeps the status', async () => {
      assignmentRepo.findOne.mockResolvedValue(activeRow());
      const events: unknown[] = [];
      const on = (p: unknown) => events.push(p);
      attentionEvents.on(ATTENTION_RECHECK, on);
      try {
        const result = await service.updateAssignment('assign-1', { due_date: '2026-01-15' }, ctx);
        expect(result.id).toBe('assign-1');
        expect(result.due_date).toBe('2026-01-15');
        expect(result.status).toBe(HomeworkAssignmentStatus.ACTIVE);
      } finally {
        attentionEvents.off(ATTENTION_RECHECK, on);
      }
      // The not-submitted alert keys on due_date, so a move rechecks it at once.
      expect(events).toEqual([
        { tenantId: TENANT_ID, ruleKey: 'homework.not_submitted', actorUserId: ctx.userId },
      ]);
    });

    it('rejects a due date before the assigned date and saves nothing', async () => {
      assignmentRepo.findOne.mockResolvedValue(activeRow());
      await expect(
        service.updateAssignment('assign-1', { due_date: '2025-12-31' }, ctx),
      ).rejects.toThrow('due_date must be on or after assigned_date');
      expect(assignmentRepo.update).not.toHaveBeenCalled();
    });

    it('loses a race with reassign: 0 rows updated gives the superseded 400', async () => {
      assignmentRepo.findOne.mockResolvedValue(activeRow());
      assignmentRepo.update.mockResolvedValueOnce({ affected: 0 });
      await expect(
        service.updateAssignment('assign-1', { status: HomeworkAssignmentStatus.DEACTIVATED }, ctx),
      ).rejects.toThrow('A superseded assignment cannot be changed');
    });

    it('rejects an empty body before any lookup', async () => {
      await expect(service.updateAssignment('assign-1', {}, ctx)).rejects.toThrow(
        'Nothing to change',
      );
      expect(assignmentRepo.findOne).not.toHaveBeenCalled();
    });

    it('maps an out-of-scope 404 to the one fixed text (Rule 23)', async () => {
      assignmentRepo.findOne.mockResolvedValue(activeRow());
      access.assertCanManageSection.mockRejectedValueOnce(
        new NotFoundException('You do not have access to this section'),
      );
      await expect(
        service.updateAssignment('assign-1', { due_date: '2026-01-15' }, ctx),
      ).rejects.toThrow('Homework assignment not found');
    });

    it('lets a ForbiddenException through as 403', async () => {
      assignmentRepo.findOne.mockResolvedValue(activeRow());
      access.assertCanManageSection.mockRejectedValueOnce(new ForbiddenException('no'));
      await expect(
        service.updateAssignment('assign-1', { due_date: '2026-01-15' }, ctx),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException for an unknown assignment', async () => {
      assignmentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateAssignment('missing', { status: HomeworkAssignmentStatus.DEACTIVATED }, ctx),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects updating an already-SUPERSEDED row', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        id: 'assign-1',
        homework_id: 'hw-1',
        section_id: 'section-1',
        student_id: null,
        status: HomeworkAssignmentStatus.SUPERSEDED,
        tenant_id: TENANT_ID,
      });
      await expect(
        service.updateAssignment('assign-1', { status: HomeworkAssignmentStatus.ACTIVE }, ctx),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
