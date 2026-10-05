import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { Permission, UserRole, hasTenantDataScope, roleHasPermission } from '@biddaloy/shared';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { PeriodSlot } from '../routines/entities/period-slot.entity';
import { ResolveRoutineService } from '../routines/resolve-routine.service';
import { ResolvedPeriod, toPeriods } from './attendance-periods.util';

/** Tenant data scope + ATTENDANCE_READ reaches every section. This service gates
 * both reads and writes (marking, finalizing); the routes add ATTENDANCE_MARK on
 * top. The permission keeps COMMITTEE (no ATTENDANCE_*, D9) out even if a looser
 * route reaches this service. SUPER_ADMIN: see `hasTenantDataScope` (#1362 D-N). */
const canAccessTenantWide = (role: string) =>
  hasTenantDataScope(role) && roleHasPermission(role, Permission.ATTENDANCE_READ);

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
    @InjectRepository(Teacher)
    private readonly teacherRepo: Repository<Teacher>,
    @InjectRepository(PeriodSlot)
    private readonly periodSlotRepo: Repository<PeriodSlot>,
    private readonly resolveRoutineService: ResolveRoutineService,
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
   * Sections this caller may mark. Tenant-scoped roles (`ROLE_SCOPE`): every section
   * in the tenant. TEACHER: only sections in `teacher_class_sections`.
   * Anyone else: empty — fails closed rather than assuming a new role
   * inherits access.
   */
  async listMarkableSections(
    role: string,
    userId: string,
    tenantId: string,
  ): Promise<ClassSection[]> {
    if (canAccessTenantWide(role)) {
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
    if (canAccessTenantWide(role)) {
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

  /**
   * The periods attendance can be taken for in a section on a date — the
   * routine resolver's slots for that date, cancelled ones dropped, each
   * numbered by its period slot's sequence (D21). No published routine → [].
   *
   * Passing a caller that is neither a routine manager nor a teacher makes the
   * resolver return PUBLISHED routines only (a DRAFT or REVIEW routine is
   * never something to take attendance against). Does no access check.
   */
  async resolvePeriods(
    tenantId: string,
    sectionId: string,
    date: string,
  ): Promise<ResolvedPeriod[]> {
    const slots = await this.resolveRoutineService.resolveRoutine(
      { section_id: sectionId, from: date, to: date },
      tenantId,
      { role: UserRole.STUDENT, userId: '' },
    );
    if (slots.length === 0) return [];
    const periodSlots = await this.periodSlotRepo.find({
      where: { id: In([...new Set(slots.map((s) => s.period_slot_id))]), tenant_id: tenantId },
    });
    return toPeriods(slots, periodSlots);
  }

  /** The periods of that date's routine this teacher is covering as the
   * substitute. Empty for any other role. */
  private async substitutePeriods(
    role: string,
    userId: string,
    sectionId: string,
    tenantId: string,
    date: string,
  ): Promise<ResolvedPeriod[]> {
    if (role !== UserRole.TEACHER) return [];
    const teacher = await this.teacherRepo.findOne({
      where: { user_id: userId, tenant_id: tenantId },
    });
    if (!teacher) return [];
    const periods = await this.resolvePeriods(tenantId, sectionId, date);
    return periods.filter((p) => p.substitute_teacher_id === teacher.id);
  }

  /**
   * Like `assertCanAccessSection`, plus: a teacher who is that date's
   * substitute for `periodNo` may touch that one period of that one date (D7,
   * D23). Never the day register (`periodNo` null), another period or another
   * date. Same 403 message as the section gate — no hint whether it exists.
   */
  async assertCanAccessPeriod(
    role: string,
    userId: string,
    sectionId: string,
    tenantId: string,
    date: string,
    periodNo: number | null,
  ): Promise<void> {
    try {
      await this.assertCanAccessSection(role, userId, sectionId, tenantId);
    } catch (err) {
      if (!(err instanceof ForbiddenException) || periodNo === null) throw err;
      const mine = await this.substitutePeriods(role, userId, sectionId, tenantId, date);
      if (!mine.some((p) => p.period_no === periodNo)) throw err;
    }
  }

  /** The periods this caller may see for the section on that date: all of them
   * with section access, only their own substituted ones otherwise (403 if none). */
  async listAccessiblePeriods(
    role: string,
    userId: string,
    sectionId: string,
    tenantId: string,
    date: string,
  ): Promise<ResolvedPeriod[]> {
    try {
      await this.assertCanAccessSection(role, userId, sectionId, tenantId);
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
      const mine = await this.substitutePeriods(role, userId, sectionId, tenantId, date);
      if (mine.length === 0) throw err;
      return mine;
    }
    return this.resolvePeriods(tenantId, sectionId, date);
  }
}
