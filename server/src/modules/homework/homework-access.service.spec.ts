import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@biddaloy/shared';
import { HomeworkAccessService } from './homework-access.service';

/**
 * Unit tests for `HomeworkAccessService` with mocked repositories — the
 * "may this caller manage homework for this section/student?" gate cloned
 * from `AttendanceAccessService`.
 */
describe('HomeworkAccessService', () => {
  const TENANT_ID = 'tenant-1';
  const SECTION_ID = 'section-1';
  const SUBJECT_ID = 'subject-1';
  const USER_ID = 'user-1';

  let sectionRepo: { findOne: ReturnType<typeof vi.fn> };
  let studentRepo: { findOne: ReturnType<typeof vi.fn> };
  let tcsRepo: { createQueryBuilder: ReturnType<typeof vi.fn> };
  let getOne: ReturnType<typeof vi.fn<() => unknown>>;
  let service: HomeworkAccessService;

  /** In-memory fixture of `teacher_class_sections` rows (already joined to
   * `teachers`), so the query-builder mock can filter on the same
   * (userId, sectionId, subjectId) params the real query filters on —
   * instead of a single canned `getOne` result — letting a test seed two
   * competing rows (two different teachers mapped to the same section) and
   * verify each teacher's own params resolve independently. */
  let tcsRows: Array<{ userId: string; sectionId: string; subjectId: string | null }>;

  beforeEach(() => {
    sectionRepo = { findOne: vi.fn() };
    studentRepo = { findOne: vi.fn() };
    tcsRows = [];
    getOne = vi.fn<() => unknown>(); // still settable directly by tests that don't need real filtering
    let params: Record<string, unknown> = {};
    const qb: Record<string, unknown> = {};
    qb.innerJoin = vi.fn().mockReturnValue(qb);
    qb.where = vi.fn((_sql: string, p?: Record<string, unknown>) => {
      params = { ...params, ...p };
      return qb;
    });
    qb.andWhere = vi.fn((_sql: string, p?: Record<string, unknown>) => {
      params = { ...params, ...p };
      return qb;
    });
    qb.getOne = vi.fn(async () => {
      if (getOne.getMockImplementation()) {
        return getOne();
      }
      return (
        tcsRows.find(
          (row) =>
            row.userId === params.userId &&
            row.sectionId === params.sectionId &&
            (row.subjectId === null || row.subjectId === params.subjectId),
        ) ?? null
      );
    });
    tcsRepo = { createQueryBuilder: vi.fn().mockReturnValue(qb) };

    service = new HomeworkAccessService(
      tcsRepo as never,
      sectionRepo as never,
      studentRepo as never,
    );
  });

  describe('assertCanManageSection', () => {
    it('allows ADMIN for any section in the tenant', async () => {
      sectionRepo.findOne.mockResolvedValue({ id: SECTION_ID, tenant_id: TENANT_ID });
      await expect(
        service.assertCanManageSection(UserRole.ADMIN, USER_ID, SECTION_ID, SUBJECT_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('throws for ADMIN when the section does not exist in this tenant', async () => {
      sectionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertCanManageSection(UserRole.ADMIN, USER_ID, SECTION_ID, SUBJECT_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a TEACHER mapped to the section (class teacher, subject_id null)', async () => {
      getOne.mockResolvedValue({ id: 'tcs-1' });
      await expect(
        service.assertCanManageSection(
          UserRole.TEACHER,
          USER_ID,
          SECTION_ID,
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).resolves.toBeUndefined();
    });

    it('denies a TEACHER not mapped to the section', async () => {
      getOne.mockResolvedValue(null);
      await expect(
        service.assertCanManageSection(
          UserRole.TEACHER,
          'unrelated-teacher',
          SECTION_ID,
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // Substitute-teacher access (D17): a second `TeacherClassSection` row for
    // the same section grants a *different* teacher access too. Two rows are
    // seeded here (not one canned `getOne` result), and each teacher's own
    // (userId, sectionId, subjectId) params are asserted to resolve
    // independently — a real substitution, not a single mock echoing back.
    it('allows a substitute teacher via a second TeacherClassSection row for the same section', async () => {
      tcsRows = [
        { userId: 'original-teacher', sectionId: SECTION_ID, subjectId: null },
        { userId: 'substitute-teacher', sectionId: SECTION_ID, subjectId: null },
      ];

      await expect(
        service.assertCanManageSection(
          UserRole.TEACHER,
          'original-teacher',
          SECTION_ID,
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).resolves.toBeUndefined();

      await expect(
        service.assertCanManageSection(
          UserRole.TEACHER,
          'substitute-teacher',
          SECTION_ID,
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).resolves.toBeUndefined();

      // A third teacher with no row for this section is still denied, even
      // though two other rows exist for it.
      await expect(
        service.assertCanManageSection(
          UserRole.TEACHER,
          'unrelated-teacher',
          SECTION_ID,
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('denies a role that is neither tenant-wide nor TEACHER', async () => {
      await expect(
        service.assertCanManageSection(
          UserRole.STUDENT,
          USER_ID,
          SECTION_ID,
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertCanManageStudent', () => {
    it('resolves the student section and delegates to assertCanManageSection', async () => {
      studentRepo.findOne.mockResolvedValue({
        id: 'student-1',
        class_section_id: SECTION_ID,
        tenant_id: TENANT_ID,
      });
      getOne.mockResolvedValue({ id: 'tcs-1' });
      await expect(
        service.assertCanManageStudent(
          UserRole.TEACHER,
          USER_ID,
          'student-1',
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).resolves.toBeUndefined();
    });

    it('throws when the student does not exist in this tenant', async () => {
      studentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertCanManageStudent(
          UserRole.TEACHER,
          USER_ID,
          'student-1',
          SUBJECT_ID,
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // Analytics rollups (D13) are subject-agnostic — a TEACHER may view a
  // section/class rollup off *any* teacher_class_sections row for it, not
  // just one matching a specific subject. Regression coverage for the
  // security gap found during wave-4 integration: the analytics routes
  // originally had no object-level scoping at all, so any TEACHER in the
  // tenant could read any other section's/class's rollup.
  describe('assertCanViewSection', () => {
    it('allows ADMIN for any section in the tenant', async () => {
      sectionRepo.findOne.mockResolvedValue({ id: SECTION_ID, tenant_id: TENANT_ID });
      await expect(
        service.assertCanViewSection(UserRole.ADMIN, USER_ID, SECTION_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('throws for ADMIN when the section does not exist in this tenant', async () => {
      sectionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertCanViewSection(UserRole.ADMIN, USER_ID, SECTION_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a TEACHER with any teacher_class_sections row for the section, subject-agnostic', async () => {
      getOne.mockResolvedValue({ id: 'tcs-1' });
      await expect(
        service.assertCanViewSection(UserRole.TEACHER, USER_ID, SECTION_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('denies a TEACHER with no teacher_class_sections row for the section', async () => {
      getOne.mockResolvedValue(null);
      await expect(
        service.assertCanViewSection(UserRole.TEACHER, 'unrelated-teacher', SECTION_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('denies any other role', async () => {
      await expect(
        service.assertCanViewSection(UserRole.PARENT, USER_ID, SECTION_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertCanViewClass', () => {
    it('allows ADMIN unconditionally', async () => {
      await expect(
        service.assertCanViewClass(UserRole.ADMIN, USER_ID, 'class-1', TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('allows a TEACHER with any teacher_class_sections row in a section of the class', async () => {
      getOne.mockResolvedValue({ id: 'tcs-1' });
      await expect(
        service.assertCanViewClass(UserRole.TEACHER, USER_ID, 'class-1', TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('denies a TEACHER with no section in the class', async () => {
      getOne.mockResolvedValue(null);
      await expect(
        service.assertCanViewClass(UserRole.TEACHER, 'unrelated-teacher', 'class-1', TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertCanViewStudent', () => {
    it('resolves the student section and delegates to assertCanViewSection', async () => {
      studentRepo.findOne.mockResolvedValue({
        id: 'student-1',
        class_section_id: SECTION_ID,
        tenant_id: TENANT_ID,
      });
      getOne.mockResolvedValue({ id: 'tcs-1' });
      await expect(
        service.assertCanViewStudent(UserRole.TEACHER, USER_ID, 'student-1', TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('throws when the student does not exist in this tenant', async () => {
      studentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertCanViewStudent(UserRole.TEACHER, USER_ID, 'student-1', TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
