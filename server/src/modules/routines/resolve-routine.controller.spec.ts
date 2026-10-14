import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@biddaloy/shared';
import { ResolveRoutineController } from './resolve-routine.controller';

const TENANT = 'tenant-1';
const USER = { sub: 'user-1' } as never;
const STUDENT = '11111111-1111-4111-8111-111111111111';
const SECTION = '22222222-2222-4222-8222-222222222222';
const TEACHER = '33333333-3333-4333-8333-333333333333';
const range = { from: '2026-10-04', to: '2026-10-10' };

describe('ResolveRoutineController family guard', () => {
  let service: { resolveRoutine: ReturnType<typeof vi.fn> };
  let familyAccess: { assertLinked: ReturnType<typeof vi.fn> };
  let controller: ResolveRoutineController;

  beforeEach(() => {
    service = { resolveRoutine: vi.fn().mockResolvedValue(['slot']) };
    familyAccess = { assertLinked: vi.fn().mockResolvedValue(undefined) };
    controller = new ResolveRoutineController(service as never, familyAccess as never);
  });

  it('PARENT with student_id: checks linkage, then calls the service', async () => {
    const query = { ...range, student_id: STUDENT };
    await controller.resolve(query, { id: TENANT, role: UserRole.PARENT }, USER);
    expect(familyAccess.assertLinked).toHaveBeenCalledWith(
      UserRole.PARENT,
      'user-1',
      STUDENT,
      TENANT,
    );
    expect(service.resolveRoutine).toHaveBeenCalledWith(query, TENANT, {
      role: UserRole.PARENT,
      userId: 'user-1',
    });
  });

  it('PARENT not linked: 401 and the service is never called', async () => {
    familyAccess.assertLinked.mockRejectedValue(new UnauthorizedException());
    await expect(
      controller.resolve(
        { ...range, student_id: STUDENT },
        { id: TENANT, role: UserRole.PARENT },
        USER,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.resolveRoutine).not.toHaveBeenCalled();
  });

  it.each([
    [UserRole.PARENT, { section_id: SECTION }],
    [UserRole.STUDENT, { teacher_id: TEACHER }],
    [UserRole.PARENT, {}],
  ])('%s with %j instead of student_id: 403, nothing called', async (role, extra) => {
    await expect(
      controller.resolve({ ...range, ...extra }, { id: TENANT, role }, USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(familyAccess.assertLinked).not.toHaveBeenCalled();
    expect(service.resolveRoutine).not.toHaveBeenCalled();
  });

  it.each([UserRole.ADMIN, UserRole.TEACHER])(
    '%s with section_id: no linkage check, query passed unchanged',
    async (role) => {
      const query = { ...range, section_id: SECTION };
      await controller.resolve(query, { id: TENANT, role }, USER);
      expect(familyAccess.assertLinked).not.toHaveBeenCalled();
      expect(service.resolveRoutine).toHaveBeenCalledWith(query, TENANT, {
        role,
        userId: 'user-1',
      });
    },
  );
});
