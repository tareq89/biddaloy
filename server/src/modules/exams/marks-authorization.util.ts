import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';

/** Roles that may write marks for every section-subject in the tenant,
 * without going through `teacher_class_sections` — same list as
 * `AttendanceAccessService`'s `TENANT_WIDE_ROLES`. */
const ADMIN_LEVEL_ROLES: string[] = [UserRole.ADMIN];

/** Roles that may *read* every section-subject's grid in the tenant.
 * Wider than `ADMIN_LEVEL_ROLES`: EXECUTIVE holds `MARK_VIEW` (route-gated
 * on `MarksController.getGrid`) for tenant-wide read access, but never
 * `MARK_ENTER`, so it has no reason to appear in the write-side list. */
const TENANT_WIDE_READ_ROLES: string[] = [UserRole.ADMIN, UserRole.EXECUTIVE];

/**
 * The single "may this caller write marks for this section-subject?"
 * gate (19.4.1 D20), a sibling of `AttendanceAccessService`. The route's
 * `@Roles(ADMIN, TEACHER)` + `@RequirePermissions(MARK_ENTER)` is only the
 * coarse gate; this is the real, object-level one. Both
 * `MarksService.upsertBatch` and `MarkGridService.submit` call this
 * directly rather than re-deriving the same join — see the issue's own
 * "do not repeat the check" instruction.
 *
 * `subject_id IS NULL` on `teacher_class_sections` means a class-teacher /
 * whole-day assignment and does **not** grant subject marks entry — only
 * a row with a matching non-null `subject_id` does.
 */
@Injectable()
export class MarksAuthorizationService {
  constructor(
    @InjectRepository(TeacherClassSection)
    private readonly tcsRepo: Repository<TeacherClassSection>,
  ) {}

  async assertCanWrite(input: {
    role: string;
    userId: string;
    tenantId: string;
    sectionId: string;
    subjectId: string;
  }): Promise<void> {
    const { role, userId, tenantId, sectionId, subjectId } = input;
    if (ADMIN_LEVEL_ROLES.includes(role)) {
      return;
    }

    // The JWT carries a **user** id, not a teacher id, so this joins
    // through `teachers` the same way `AttendanceAccessService` does.
    // Every table is filtered on `tenant_id`, not just `tcs` — this is
    // the boundary deciding whether one school's teacher can write marks
    // for another school's section.
    const assignment = await this.tcsRepo
      .createQueryBuilder('tcs')
      .innerJoin('teachers', 't', 't.id = tcs.teacher_id AND t.tenant_id = :tenantId', {
        tenantId,
      })
      .where('tcs.tenant_id = :tenantId', { tenantId })
      .andWhere('tcs.section_id = :sectionId', { sectionId })
      .andWhere('tcs.subject_id = :subjectId', { subjectId })
      .andWhere('t.user_id = :userId', { userId })
      .getOne();

    if (!assignment) {
      throw new ForbiddenException(
        'You are not the assigned subject teacher for this section-subject.',
      );
    }
  }

  /** [pr-fix #945] `MarksController.getGrid` had no object-level check at
   * all — any MARK_VIEW holder (which TEACHER has, tenant-wide) could
   * read any section's marks by supplying an arbitrary section_id. Same
   * join as `assertCanWrite`, but EXECUTIVE also bypasses it (read-only
   * tenant-wide access; EXECUTIVE never holds MARK_ENTER). */
  async assertCanRead(input: {
    role: string;
    userId: string;
    tenantId: string;
    sectionId: string;
    subjectId: string;
  }): Promise<void> {
    const { role, userId, tenantId, sectionId, subjectId } = input;
    if (TENANT_WIDE_READ_ROLES.includes(role)) {
      return;
    }

    const assignment = await this.tcsRepo
      .createQueryBuilder('tcs')
      .innerJoin('teachers', 't', 't.id = tcs.teacher_id AND t.tenant_id = :tenantId', {
        tenantId,
      })
      .where('tcs.tenant_id = :tenantId', { tenantId })
      .andWhere('tcs.section_id = :sectionId', { sectionId })
      .andWhere('tcs.subject_id = :subjectId', { subjectId })
      .andWhere('t.user_id = :userId', { userId })
      .getOne();

    if (!assignment) {
      throw new ForbiddenException(
        'You are not the assigned subject teacher for this section-subject.',
      );
    }
  }
}
