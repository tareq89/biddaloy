import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MarksAuthorizationService } from './marks-authorization.util';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { UserRole } from '@biddaloy/shared';

const TENANT_ID = 'tenant-1';

async function buildService(assignment: unknown = null) {
  const qb: any = {
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getOne: vi.fn(async () => assignment),
  };
  const tcsRepo: any = { createQueryBuilder: vi.fn(() => qb) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      MarksAuthorizationService,
      { provide: getRepositoryToken(TeacherClassSection), useValue: tcsRepo },
    ],
  }).compile();

  return { service: moduleRef.get(MarksAuthorizationService), qb };
}

describe('MarksAuthorizationService.assertCanWrite (issue rule #4)', () => {
  it('allows ADMIN without checking teacher_class_sections', async () => {
    const { service, qb } = await buildService();

    await expect(
      service.assertCanWrite({
        role: UserRole.ADMIN,
        userId: 'u1',
        tenantId: TENANT_ID,
        sectionId: 's1',
        subjectId: 'subj1',
      }),
    ).resolves.toBeUndefined();
    expect(qb.getOne).not.toHaveBeenCalled();
  });

  it('allows a TEACHER with a matching (section, subject) assignment', async () => {
    const { service } = await buildService({ id: 'tcs-1', section_id: 's1', subject_id: 'subj1' });

    await expect(
      service.assertCanWrite({
        role: UserRole.TEACHER,
        userId: 'u1',
        tenantId: TENANT_ID,
        sectionId: 's1',
        subjectId: 'subj1',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a TEACHER with only a class-teacher assignment (subject_id IS NULL)', async () => {
    // The query itself filters `subject_id = :subjectId`, so a NULL-subject
    // class-teacher row is never returned by getOne() here.
    const { service } = await buildService(null);

    await expect(
      service.assertCanWrite({
        role: UserRole.TEACHER,
        userId: 'u1',
        tenantId: TENANT_ID,
        sectionId: 's1',
        subjectId: 'subj1',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a TEACHER assigned to a different section', async () => {
    const { service } = await buildService(null);

    await expect(
      service.assertCanWrite({
        role: UserRole.TEACHER,
        userId: 'u1',
        tenantId: TENANT_ID,
        sectionId: 'other-section',
        subjectId: 'subj1',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects any other role', async () => {
    const { service } = await buildService(null);

    await expect(
      service.assertCanWrite({
        role: UserRole.ACCOUNTANT,
        userId: 'u1',
        tenantId: TENANT_ID,
        sectionId: 's1',
        subjectId: 'subj1',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

// [#1362] Per-role table. write = may write marks to an unmapped section-subject;
// read = may read its grid. TEACHER is section-scoped (denied when unmapped).
describe('MarksAuthorizationService per-role table', () => {
  const input = (role: UserRole) => ({
    role,
    userId: 'u1',
    tenantId: TENANT_ID,
    sectionId: 's1',
    subjectId: 'subj1',
  });
  const TABLE: Array<[UserRole, boolean, boolean]> = [
    [UserRole.ADMIN, true, true],
    [UserRole.EXECUTIVE, false, true],
    [UserRole.ACCOUNTANT, false, false],
    // New in #1362 (ROLE_SCOPE + permission): SUPER_ADMIN reads tenant-wide but is held
    // out of tenant-wide writes until product decides (D-N); EXAM_CONTROLLER reads only
    // (D16); OFFICE_STAFF and COMMITTEE hold no mark permission, so COMMITTEE never
    // reaches marks (D9).
    [UserRole.SUPER_ADMIN, false, true],
    [UserRole.EXAM_CONTROLLER, false, true],
    [UserRole.OFFICE_STAFF, false, false],
    [UserRole.COMMITTEE, false, false],
    [UserRole.TEACHER, false, false],
    [UserRole.PARENT, false, false],
    [UserRole.STUDENT, false, false],
  ];
  it.each(TABLE)('%s: write=%s read=%s', async (role, write, read) => {
    const { service } = await buildService(null);
    const w = service.assertCanWrite(input(role));
    const r = service.assertCanRead(input(role));
    if (write) await expect(w).resolves.toBeUndefined();
    else await expect(w).rejects.toThrow(ForbiddenException);
    if (read) await expect(r).resolves.toBeUndefined();
    else await expect(r).rejects.toThrow(ForbiddenException);
  });
});
