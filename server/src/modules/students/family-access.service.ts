import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { UserRole, isGuardianRole } from '@biddaloy/shared';
import { Student } from './entities/student.entity';

/**
 * The single home of Biddaloy's object-level "is this family caller allowed
 * to see this student?" check [5.1].
 *
 * Role alone is never enough for a PARENT or STUDENT. `@Roles(PARENT, STUDENT)`
 * on a route only says "a family caller may attempt this"; *which* student's
 * data comes back is decided here, by the linkage rows:
 *
 * ```
 * PARENT   → students.guardians[].user_id === caller  (via student_guardians)
 * STUDENT  → students.user_id            === caller
 * ```
 *
 * Every query below is explicitly scoped to `tenant_id` and skips
 * soft-deleted students, per `.claude/skills/multi-tenancy/SKILL.md` — there
 * is no ambient tenant filter in this codebase. A parent who is genuinely
 * linked to a student in tenant B, but calls with `X-Tenant-ID: A`, matches
 * nothing here: the linkage lookup is scoped to A.
 *
 * Staff roles pass straight through (`assertLinked` is a no-op) — their
 * access is already decided by the route's `@Roles` list plus the service
 * layer's own tenant scoping, and staff are not "linked" to anyone.
 *
 * Do not re-implement this check in a controller. Before [5.1] it lived
 * inline in `students.controller.ts`; every widened family route now calls
 * this service instead so there is exactly one definition of "linked".
 */
@Injectable()
export class FamilyAccessService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  /**
   * Base query for "students this family caller is linked to", already
   * tenant-scoped and soft-delete filtered.
   *
   * Returns `null` for a non-family role — callers treat that as "this role
   * has no linkage concept", not as "no students".
   */
  private linkedStudentsQuery(
    role: string,
    userId: string,
    tenantId: string,
  ): SelectQueryBuilder<Student> | null {
    if (!isGuardianRole(role)) {
      return null;
    }

    const qb = this.studentRepo
      .createQueryBuilder('student')
      .where('student.tenant_id = :tenantId', { tenantId })
      .andWhere('student.deleted_at IS NULL');

    if (role === UserRole.PARENT) {
      // INNER JOIN, so a parent with no linkage rows matches nothing rather
      // than matching every student in the tenant.
      qb.innerJoin('student.guardians', 'guardian').andWhere('guardian.user_id = :userId', {
        userId,
      });
    } else {
      qb.andWhere('student.user_id = :userId', { userId });
    }

    return qb;
  }

  /**
   * The students a PARENT/STUDENT caller may see, for `GET /students/mine`.
   *
   * Deliberately minimal relations — class/section for display, and *not*
   * `guardians`: the guardian rows carry every co-guardian's phone and email,
   * which the discovery list has no need for. `GET /students/:id` remains the
   * place that returns the fuller record.
   *
   * A non-family role gets an empty list. `GET /students/mine` is
   * `@Roles(PARENT, STUDENT)` so this is unreachable in practice, but it
   * fails closed rather than leaking the roster if the route is ever widened.
   */
  async getLinkedStudents(role: string, userId: string, tenantId: string): Promise<Student[]> {
    const qb = this.linkedStudentsQuery(role, userId, tenantId);
    if (!qb) return [];

    return qb
      .leftJoinAndSelect('student.class_section', 'class_section')
      .leftJoinAndSelect('class_section.class', 'class')
      .orderBy('student.full_name', 'ASC')
      .addOrderBy('student.id', 'ASC')
      .getMany();
  }

  /**
   * ID-only variant, for routes that restrict a list query to the caller's
   * students (`GET /invoices`, `GET /fees/dues`) rather than fetching them.
   */
  async getLinkedStudentIds(role: string, userId: string, tenantId: string): Promise<string[]> {
    const qb = this.linkedStudentsQuery(role, userId, tenantId);
    if (!qb) return [];

    // DISTINCT because the PARENT join can match the same student through
    // more than one guardian row (e.g. the caller is recorded twice with
    // different relationships).
    const rows = await qb.select('DISTINCT student.id', 'id').getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  /**
   * Throws unless the caller may read this specific student.
   *
   * No-op for staff roles. For PARENT/STUDENT it throws
   * `UnauthorizedException` with the exact message the inline check in
   * `students.controller.ts` threw before [5.1] — the contract that route
   * already had is unchanged, including the (unconventional but deliberate)
   * 401-rather-than-403 status.
   */
  async assertLinked(
    role: string,
    userId: string,
    studentId: string,
    tenantId: string,
  ): Promise<void> {
    const qb = this.linkedStudentsQuery(role, userId, tenantId);
    if (!qb) return;

    const count = await qb.andWhere('student.id = :studentId', { studentId }).getCount();
    if (count === 0) {
      throw new UnauthorizedException("You do not have access to this student's information");
    }
  }
}
