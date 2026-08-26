import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRole } from '@biddaloy/shared';
import { FamilyAccessService } from './family-access.service';
import { Student } from './entities/student.entity';

/**
 * Unit tests for the one object-level linkage check [5.1].
 *
 * The repository is mocked so these tests assert the *shape of the query*
 * the service builds — which is exactly where a tenant filter goes missing.
 * `family-access.service.integration.spec.ts` proves the same rules against
 * a real database.
 */

/** A chainable QueryBuilder stub that records every `where`/`andWhere`. */
function createQueryBuilderStub(result: { entities?: unknown[]; raw?: unknown[]; count?: number }) {
  const conditions: Array<{ sql: string; params?: Record<string, unknown> }> = [];
  const joins: string[] = [];

  const qb: any = {
    conditions,
    joins,
    where: vi.fn((sql: string, params?: Record<string, unknown>) => {
      conditions.push({ sql, params });
      return qb;
    }),
    andWhere: vi.fn((sql: string, params?: Record<string, unknown>) => {
      conditions.push({ sql, params });
      return qb;
    }),
    innerJoin: vi.fn((relation: string) => {
      joins.push(relation);
      return qb;
    }),
    leftJoinAndSelect: vi.fn(() => qb),
    select: vi.fn(() => qb),
    orderBy: vi.fn(() => qb),
    addOrderBy: vi.fn(() => qb),
    getMany: vi.fn(async () => result.entities ?? []),
    getRawMany: vi.fn(async () => result.raw ?? []),
    getCount: vi.fn(async () => result.count ?? 0),
  };
  return qb;
}

const USER_ID = 'user-1';
const TENANT_ID = 'tenant-1';
const STUDENT_ID = 'student-1';

describe('FamilyAccessService', () => {
  let service: FamilyAccessService;
  let repo: { createQueryBuilder: ReturnType<typeof vi.fn> };
  let qb: ReturnType<typeof createQueryBuilderStub>;

  async function build(result: Parameters<typeof createQueryBuilderStub>[0] = {}) {
    qb = createQueryBuilderStub(result);
    repo = { createQueryBuilder: vi.fn(() => qb) };

    const moduleRef = await Test.createTestingModule({
      providers: [FamilyAccessService, { provide: getRepositoryToken(Student), useValue: repo }],
    }).compile();

    service = moduleRef.get(FamilyAccessService);
  }

  /** Flattens the recorded conditions into one string for substring asserts. */
  function sql(): string {
    return qb.conditions.map((c: { sql: string }) => c.sql).join(' AND ');
  }

  beforeEach(async () => {
    await build();
  });

  describe('assertLinked', () => {
    // Staff authorization is decided by the route's @Roles list plus the
    // service layer's tenant scoping; staff are not "linked" to anyone, so
    // the check must be a no-op rather than a refusal.
    const STAFF_ROLES = [
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
    ];

    for (const role of STAFF_ROLES) {
      it(`is a no-op for ${role} and issues no query`, async () => {
        await build({ count: 0 });
        await expect(
          service.assertLinked(role, USER_ID, STUDENT_ID, TENANT_ID),
        ).resolves.toBeUndefined();
        expect(repo.createQueryBuilder).not.toHaveBeenCalled();
      });
    }

    it('is a no-op for an unknown or absent role, which is not a family role', async () => {
      await build({ count: 0 });
      await expect(
        service.assertLinked('NOT_A_ROLE', USER_ID, STUDENT_ID, TENANT_ID),
      ).resolves.toBeUndefined();
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('resolves for a PARENT when a linkage row matches', async () => {
      await build({ count: 1 });
      await expect(
        service.assertLinked(UserRole.PARENT, USER_ID, STUDENT_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('throws for a PARENT with no linkage row', async () => {
      await build({ count: 0 });
      await expect(
        service.assertLinked(UserRole.PARENT, USER_ID, STUDENT_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    // The message and the (unconventional) 401 are the contract
    // students.controller.ts already had before [5.1] moved the check here.
    // Changing either would break existing clients, so it is pinned.
    it('throws the exact message the inline check used before [5.1]', async () => {
      await build({ count: 0 });
      await expect(
        service.assertLinked(UserRole.STUDENT, USER_ID, STUDENT_ID, TENANT_ID),
      ).rejects.toThrow("You do not have access to this student's information");
    });

    it('scopes the PARENT check to the tenant, the guardian linkage and the student id', async () => {
      await build({ count: 1 });
      await service.assertLinked(UserRole.PARENT, USER_ID, STUDENT_ID, TENANT_ID);

      expect(qb.joins).toContain('student.guardians');
      expect(sql()).toContain('student.tenant_id = :tenantId');
      expect(sql()).toContain('student.deleted_at IS NULL');
      expect(sql()).toContain('guardian.user_id = :userId');
      expect(sql()).toContain('student.id = :studentId');
    });

    it('scopes the STUDENT check to the tenant and the student user_id, with no guardian join', async () => {
      await build({ count: 1 });
      await service.assertLinked(UserRole.STUDENT, USER_ID, STUDENT_ID, TENANT_ID);

      expect(qb.joins).toEqual([]);
      expect(sql()).toContain('student.tenant_id = :tenantId');
      expect(sql()).toContain('student.deleted_at IS NULL');
      expect(sql()).toContain('student.user_id = :userId');
      expect(sql()).toContain('student.id = :studentId');
    });

    it('passes the caller-supplied ids as bound parameters, never string-interpolated', async () => {
      await build({ count: 1 });
      await service.assertLinked(UserRole.PARENT, USER_ID, STUDENT_ID, TENANT_ID);

      const params = Object.assign({}, ...qb.conditions.map((c: any) => c.params ?? {}));
      expect(params).toMatchObject({
        tenantId: TENANT_ID,
        userId: USER_ID,
        studentId: STUDENT_ID,
      });
    });
  });

  describe('getLinkedStudents', () => {
    it('returns the matched students for a PARENT', async () => {
      const student = { id: STUDENT_ID } as Student;
      await build({ entities: [student] });

      await expect(service.getLinkedStudents(UserRole.PARENT, USER_ID, TENANT_ID)).resolves.toEqual(
        [student],
      );
    });

    // Fails closed: if this route were ever widened to a staff role by
    // mistake, it must not become a second, unpaginated roster endpoint.
    it('returns an empty list for a staff role without querying', async () => {
      await build({ entities: [{ id: 'someone-elses-student' }] });

      await expect(service.getLinkedStudents(UserRole.ADMIN, USER_ID, TENANT_ID)).resolves.toEqual(
        [],
      );
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('does not join the guardians relation into the response', async () => {
      await build({ entities: [] });
      await service.getLinkedStudents(UserRole.PARENT, USER_ID, TENANT_ID);

      // guardians is INNER JOINed for the linkage predicate but never
      // selected — co-guardian phone/email must not ride along in the
      // discovery list.
      expect(qb.leftJoinAndSelect.mock.calls.map((c: unknown[]) => c[0])).toEqual([
        'student.class_section',
        'class_section.class',
      ]);
    });
  });

  describe('getLinkedStudentIds', () => {
    it('returns just the ids for a STUDENT caller', async () => {
      await build({ raw: [{ id: STUDENT_ID }] });

      await expect(
        service.getLinkedStudentIds(UserRole.STUDENT, USER_ID, TENANT_ID),
      ).resolves.toEqual([STUDENT_ID]);
    });

    it('selects DISTINCT ids, so a doubly-linked guardian does not duplicate a student', async () => {
      await build({ raw: [] });
      await service.getLinkedStudentIds(UserRole.PARENT, USER_ID, TENANT_ID);

      expect(qb.select).toHaveBeenCalledWith('DISTINCT student.id', 'id');
    });

    it('returns an empty list for a staff role without querying', async () => {
      await build({ raw: [{ id: 'someone-elses-student' }] });

      await expect(
        service.getLinkedStudentIds(UserRole.TEACHER, USER_ID, TENANT_ID),
      ).resolves.toEqual([]);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
