import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { MarksAuthorizationService } from './marks-authorization.util';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { TeacherAssignmentType, UserRole } from '@biddaloy/shared';

const TENANT_ID = 'tenant-1';

type Roles = Awaited<ReturnType<TeacherScopeService['rolesInSection']>>;

/** `TeacherScopeService` is stubbed: its join (live subjects only, tenant
 * filtering) is covered by `teacher-scope.service.integration.spec.ts`. Here
 * we only check the decision made from what it returns. */
function buildService(roles: Roles = { homeroom: null, subjectIds: [] }) {
  const rolesInSection = vi.fn(async () => roles);
  const service = new MarksAuthorizationService({
    rolesInSection,
  } as unknown as TeacherScopeService);
  return { service, rolesInSection };
}

const input = (role: UserRole, over: Partial<{ sectionId: string; subjectId: string }> = {}) => ({
  role,
  userId: 'u1',
  tenantId: TENANT_ID,
  sectionId: 's1',
  subjectId: 'subj1',
  ...over,
});

describe('MarksAuthorizationService.assertCanWrite', () => {
  it('allows ADMIN without asking TeacherScopeService', async () => {
    const { service, rolesInSection } = buildService();
    await expect(service.assertCanWrite(input(UserRole.ADMIN))).resolves.toBeUndefined();
    expect(rolesInSection).not.toHaveBeenCalled();
  });

  it('allows a TEACHER who teaches the (live) subject in the section', async () => {
    const { service, rolesInSection } = buildService({ homeroom: null, subjectIds: ['subj1'] });
    await expect(service.assertCanWrite(input(UserRole.TEACHER))).resolves.toBeUndefined();
    // The tenant and section reach the scope query — it is the isolation boundary.
    expect(rolesInSection).toHaveBeenCalledWith({
      userId: 'u1',
      tenantId: TENANT_ID,
      sectionId: 's1',
    });
  });

  it('rejects a TEACHER with a different subject in the section', async () => {
    const { service } = buildService({ homeroom: null, subjectIds: ['other'] });
    await expect(service.assertCanWrite(input(UserRole.TEACHER))).rejects.toThrow(
      ForbiddenException,
    );
  });

  // D16: homeroom never grants write.
  it.each([
    TeacherAssignmentType.CLASS_TEACHER,
    TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
  ] as const)('rejects a %s homeroom teacher who does not teach the subject', async (homeroom) => {
    const { service } = buildService({ homeroom, subjectIds: [] });
    await expect(service.assertCanWrite(input(UserRole.TEACHER))).rejects.toThrow(
      ForbiddenException,
    );
  });

  // A soft-deleted subject never appears in `subjectIds` (the service filters
  // it), so its former teacher is denied.
  it('rejects a TEACHER whose subject was soft-deleted (absent from subjectIds)', async () => {
    const { service } = buildService({ homeroom: null, subjectIds: [] });
    await expect(service.assertCanWrite(input(UserRole.TEACHER))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects any other role', async () => {
    const { service } = buildService();
    await expect(service.assertCanWrite(input(UserRole.ACCOUNTANT))).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('MarksAuthorizationService.assertCanRead', () => {
  it('allows a TEACHER who teaches the subject', async () => {
    const { service } = buildService({ homeroom: null, subjectIds: ['subj1'] });
    await expect(service.assertCanRead(input(UserRole.TEACHER))).resolves.toBeUndefined();
  });

  // D3: homeroom reads every subject of its own section.
  it.each([
    TeacherAssignmentType.CLASS_TEACHER,
    TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
  ] as const)(
    "allows a %s homeroom teacher to read another teacher's subject",
    async (homeroom) => {
      const { service } = buildService({ homeroom, subjectIds: [] });
      await expect(service.assertCanRead(input(UserRole.TEACHER))).resolves.toBeUndefined();
    },
  );

  it('rejects a TEACHER with no row in the section', async () => {
    const { service } = buildService({ homeroom: null, subjectIds: [] });
    await expect(service.assertCanRead(input(UserRole.TEACHER))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a TEACHER with only another subject in the section', async () => {
    const { service } = buildService({ homeroom: null, subjectIds: ['other'] });
    await expect(service.assertCanRead(input(UserRole.TEACHER))).rejects.toThrow(
      ForbiddenException,
    );
  });
});

// [#1362] Per-role table. write = may write marks to an unmapped section-subject;
// read = may read its grid. TEACHER is section-scoped (denied when unmapped).
describe('MarksAuthorizationService per-role table', () => {
  const TABLE: Array<[UserRole, boolean, boolean]> = [
    [UserRole.ADMIN, true, true],
    [UserRole.EXECUTIVE, false, true],
    [UserRole.ACCOUNTANT, false, false],
    // SUPER_ADMIN is out of tenant data scope, reads and writes, until product
    // decides (D-N); EXAM_CONTROLLER reads only (D16); OFFICE_STAFF and COMMITTEE
    // hold no mark permission, so COMMITTEE never reaches marks (D9).
    [UserRole.SUPER_ADMIN, false, false],
    [UserRole.EXAM_CONTROLLER, false, true],
    [UserRole.OFFICE_STAFF, false, false],
    [UserRole.COMMITTEE, false, false],
    [UserRole.TEACHER, false, false],
    [UserRole.PARENT, false, false],
    [UserRole.STUDENT, false, false],
  ];
  it.each(TABLE)('%s: write=%s read=%s', async (role, write, read) => {
    const { service } = buildService();
    const w = service.assertCanWrite(input(role));
    const r = service.assertCanRead(input(role));
    if (write) await expect(w).resolves.toBeUndefined();
    else await expect(w).rejects.toThrow(ForbiddenException);
    if (read) await expect(r).resolves.toBeUndefined();
    else await expect(r).rejects.toThrow(ForbiddenException);
  });
});
