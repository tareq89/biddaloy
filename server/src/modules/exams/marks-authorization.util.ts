import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission, UserRole, hasTenantScope, roleHasPermission } from '@biddaloy/shared';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';

/** Tenant scope + MARK_ENTER may write marks for every section-subject
 * without going through `teacher_class_sections`. EXAM_CONTROLLER has no
 * MARK_ENTER (D16), so it stays out.
 * ponytail: #1362 D-N — SUPER_ADMIN is held out of tenant-wide *writes*
 * (as before Epic 24) until product decides; drop the check to widen it. */
const canWriteTenantWide = (role: string) =>
  role !== UserRole.SUPER_ADMIN &&
  hasTenantScope(role) &&
  roleHasPermission(role, Permission.MARK_ENTER);

/** Tenant scope + MARK_VIEW may *read* every section-subject's grid.
 * Wider than the write side: EXECUTIVE and EXAM_CONTROLLER hold MARK_VIEW
 * but never MARK_ENTER. COMMITTEE has no MARK_VIEW, so never reaches marks (D9). */
const canReadTenantWide = (role: string) =>
  hasTenantScope(role) && roleHasPermission(role, Permission.MARK_VIEW);

/**
 * The single "may this caller write marks for this section-subject?"
 * gate (19.4.1 D20), a sibling of `AttendanceAccessService`. The route's
 * `@RequirePermissions(MARK_ENTER)` (held by ADMIN and TEACHER) is only the
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
    if (canWriteTenantWide(role)) {
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
    if (canReadTenantWide(role)) {
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
