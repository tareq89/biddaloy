import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { ClassSection } from '../academics/entities/class-section.entity';

/** Roles that may mark/read attendance for every section in the tenant,
 * without going through `teacher_class_sections`. */
const TENANT_WIDE_ROLES: string[] = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT];

/**
 * The object-level "may this caller touch this section's attendance?" gate —
 * a sibling of `FamilyAccessService` (`server/src/modules/students/`), kept
 * as its own service rather than logic smeared through the controller or
 * `AttendanceService`.
 *
 * The route-level `@Roles(...)` on `attendance.controller.ts` is only the
 * coarse gate ("a TEACHER may attempt this at all"); this service is the
 * real one ("which sections"). [9.4], [9.5] and [9.8] inject this directly
 * rather than re-deriving the same join.
 */
@Injectable()
export class AttendanceAccessService {
  constructor(
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
  ) {}

  /**
   * The teacher-scoped query, joining through `teachers` — the JWT carries a
   * **user** id, not a teacher id, so `teacher_class_sections.teacher_id`
   * cannot be matched directly against the caller. Every table in the join
   * is filtered on `tenant_id`, not just `class_sections` — belt and braces
   * is cheap here, and this is the boundary that decides whether one
   * school's teacher can mark another school's students.
   */
  private teacherSectionsQuery(userId: string, tenantId: string): SelectQueryBuilder<ClassSection> {
    return this.sectionRepo
      .createQueryBuilder('cs')
      .innerJoin(
        'teacher_class_sections',
        'tcs',
        'tcs.section_id = cs.id AND tcs.tenant_id = :tenantId',
        { tenantId },
      )
      .innerJoin('teachers', 't', 't.id = tcs.teacher_id AND t.tenant_id = :tenantId', {
        tenantId,
      })
      .where('cs.tenant_id = :tenantId', { tenantId })
      .andWhere('cs.deleted_at IS NULL')
      .andWhere('t.user_id = :userId', { userId });
  }

  /**
   * Sections this caller may mark. ADMIN/EXECUTIVE/ACCOUNTANT: every section
   * in the tenant. TEACHER: only sections in `teacher_class_sections`.
   * Anyone else: empty — fails closed rather than assuming a new role
   * inherits access.
   */
  async listMarkableSections(
    role: string,
    userId: string,
    tenantId: string,
  ): Promise<ClassSection[]> {
    if (TENANT_WIDE_ROLES.includes(role)) {
      return this.sectionRepo.find({
        where: { tenant_id: tenantId },
        relations: ['class'],
        order: { section_name: 'ASC' },
      });
    }

    if (role === UserRole.TEACHER) {
      // DISTINCT because a teacher can be mapped to the same section more
      // than once (e.g. class-teacher row plus one or more subject-teacher
      // rows), which would otherwise duplicate the section in this list.
      // `class` is eager-loaded here (not just on `assertCanAccessSection`)
      // because `AttendanceService.listMySections` needs `class_name` for
      // every section this returns, without an N+1 follow-up query.
      return this.teacherSectionsQuery(userId, tenantId)
        .leftJoinAndSelect('cs.class', 'class')
        .distinct(true)
        .orderBy('cs.section_name', 'ASC')
        .getMany();
    }

    return [];
  }

  /**
   * Throws `ForbiddenException` (403) when the caller may not touch this
   * section's attendance, otherwise returns it. A section that simply
   * doesn't exist in this tenant is indistinguishable from one the caller
   * isn't mapped to — both come back 403, so a cross-tenant probe learns
   * nothing about whether the id exists elsewhere.
   */
  async assertCanAccessSection(
    role: string,
    userId: string,
    sectionId: string,
    tenantId: string,
  ): Promise<ClassSection> {
    if (TENANT_WIDE_ROLES.includes(role)) {
      const section = await this.sectionRepo.findOne({
        where: { id: sectionId, tenant_id: tenantId },
      });
      if (!section) {
        throw new ForbiddenException('You do not have access to this section');
      }
      return section;
    }

    if (role === UserRole.TEACHER) {
      const section = await this.teacherSectionsQuery(userId, tenantId)
        .andWhere('cs.id = :sectionId', { sectionId })
        .getOne();
      if (!section) {
        throw new ForbiddenException('You do not have access to this section');
      }
      return section;
    }

    throw new ForbiddenException('This role cannot access attendance registers');
  }
}
