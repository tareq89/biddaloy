import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Repository } from 'typeorm';
import { Routine } from './entities/routine.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { RoutineSlotTeacher } from './entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from './entities/routine-substitution.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { occursOn } from './recurrence';
import { ResolveRoutineQueryDto, ResolvedSlot } from './dto/resolve.dto';
import {
  EnrollmentStatus,
  Permission,
  PeriodSlotKind,
  RoutineState,
  UserRole,
  roleHasPermission,
} from '@biddaloy/shared';

/** Who is asking, for the DRAFT/REVIEW visibility rule below (D11 step 2). */
export interface ResolveRoutineCaller {
  role: string;
  userId: string;
}

/**
 * [21.5.1] D14: the **only** resolver of "what is on, for whom, between
 * these dates" — recurrence, effective dating, weekly-off/holiday
 * exclusion and substitutions are all interpreted here and nowhere else.
 * Every consumer (grid, agenda, portal, Epic 41.0 attendance, Epic 37.0
 * online classes) calls this rather than re-querying `routine_slots`.
 */
@Injectable()
export class ResolveRoutineService {
  constructor(
    @InjectRepository(Routine) private readonly routineRepo: Repository<Routine>,
    @InjectRepository(RoutineSlot) private readonly slotRepo: Repository<RoutineSlot>,
    @InjectRepository(RoutineSlotTeacher)
    private readonly slotTeacherRepo: Repository<RoutineSlotTeacher>,
    @InjectRepository(RoutineSubstitution)
    private readonly substitutionRepo: Repository<RoutineSubstitution>,
    @InjectRepository(PeriodSlot) private readonly periodSlotRepo: Repository<PeriodSlot>,
    @InjectRepository(AcademicYear) private readonly yearRepo: Repository<AcademicYear>,
    @InjectRepository(Enrollment) private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Teacher) private readonly teacherRepo: Repository<Teacher>,
    private readonly calendarService: SchoolCalendarService,
  ) {}

  async resolveRoutine(
    query: ResolveRoutineQueryDto,
    tenantId: string,
    caller: ResolveRoutineCaller,
  ): Promise<ResolvedSlot[]> {
    const identifiers = [query.section_id, query.teacher_id, query.student_id].filter(Boolean);
    if (identifiers.length !== 1) {
      throw new BadRequestException(
        'Exactly one of section_id, teacher_id or student_id is required',
      );
    }

    let sectionId = query.section_id ?? (await this.resolveStudentSection(query, tenantId));
    if (query.student_id && !sectionId) {
      return [];
    }

    // D14: the published routine for the academic year covering `from`
    // (tenant is always taken from request context, never a parameter — D16).
    // A fluent `where` can't express "date column between two variables it
    // straddles", so this is a raw range query rather than `Between`.
    const academicYear = await this.yearRepo
      .createQueryBuilder('y')
      .where('y.tenant_id = :tenantId', { tenantId })
      .andWhere('y.deleted_at IS NULL')
      .andWhere('y.start_date <= :from AND y.end_date >= :from', { from: query.from })
      .getOne();
    if (!academicYear) return [];

    // D11 step 2: state governs visibility, decided here — the one
    // place D14 says all visibility rules must live, rather than each
    // consumer re-deriving it. tenant is always taken from request
    // context above, never a caller-supplied parameter.
    const routine = await this.routineRepo.findOne({
      where: { tenant_id: tenantId, academic_year_id: academicYear.id, deleted_at: IsNull() },
    });
    if (!routine) return [];

    const isManager = roleHasPermission(caller.role, Permission.ROUTINE_MANAGE);
    let effectiveQuery = query;

    if (routine.state === RoutineState.DRAFT) {
      // Draft is builder-only.
      if (!isManager) return [];
    } else if (routine.state === RoutineState.REVIEW) {
      if (!isManager) {
        // A teacher sees only their own slots while in review; anyone
        // else (guardian, student, executive) sees nothing yet.
        if (caller.role !== UserRole.TEACHER) return [];
        const teacher = await this.teacherRepo.findOne({
          where: { user_id: caller.userId, tenant_id: tenantId },
        });
        if (!teacher) return [];
        // Force to the caller's own teacher id — never trust a
        // caller-supplied teacher_id/section_id/student_id for this
        // restriction, even if the request asked for a section or
        // another student's section.
        effectiveQuery = { ...query, teacher_id: teacher.id };
        sectionId = null;
      }
    }
    // PUBLISHED: any ROUTINE_READ holder may read (existing behavior,
    // unrestricted beyond the section/teacher/student filter already
    // required above).

    const { dates } = await this.calendarService.getWorkingDays({
      tenantId,
      from: query.from,
      to: query.to,
      academicYearId: academicYear.id,
    });
    if (dates.length === 0) return [];

    const slots = await this.slotRepo.find({
      where: {
        routine_id: routine.id,
        tenant_id: tenantId,
        ...(sectionId ? { section_id: sectionId } : {}),
      },
    });
    if (slots.length === 0) return [];

    const slotIds = slots.map((s) => s.id);
    const periodSlotIds = Array.from(new Set(slots.map((s) => s.period_slot_id)));

    const [periodSlots, teacherRows, substitutions] = await Promise.all([
      this.periodSlotRepo.find({ where: { id: In(periodSlotIds), tenant_id: tenantId } }),
      this.slotTeacherRepo.find({ where: { routine_slot_id: In(slotIds), tenant_id: tenantId } }),
      this.substitutionRepo.find({
        where: {
          routine_slot_id: In(slotIds),
          tenant_id: tenantId,
          date: Between(query.from, query.to),
        },
      }),
    ]);

    const kindBySlot = new Map(periodSlots.map((p) => [p.id, p.kind]));
    const teachersBySlot = new Map<string, string[]>();
    for (const row of teacherRows) {
      const list = teachersBySlot.get(row.routine_slot_id) ?? [];
      list.push(row.teacher_id);
      teachersBySlot.set(row.routine_slot_id, list);
    }
    const substitutionByKey = new Map(
      substitutions.map((s) => [`${s.routine_slot_id}|${s.date}`, s]),
    );

    const results: ResolvedSlot[] = [];
    for (const slot of slots) {
      const kind = kindBySlot.get(slot.period_slot_id) ?? PeriodSlotKind.CLASS;
      if (kind === PeriodSlotKind.BREAK && !query.include_breaks) continue;

      const ownTeacherIds = teachersBySlot.get(slot.id) ?? [];
      const validTo = slot.valid_to ?? '9999-12-31';

      for (const date of dates) {
        if (date < slot.valid_from || date > validTo) continue;
        if (!occursOn(slot, date, academicYear.start_date as unknown as string)) continue;

        const sub = substitutionByKey.get(`${slot.id}|${date}`);
        const cancelled = sub?.is_cancelled ?? false;
        const substituted = !!sub?.substitute_teacher_id;

        if (effectiveQuery.teacher_id) {
          const isOwn = ownTeacherIds.includes(effectiveQuery.teacher_id) && !substituted;
          const isCovering =
            substituted && sub!.substitute_teacher_id === effectiveQuery.teacher_id;
          if (!isOwn && !isCovering) continue;
        }

        results.push({
          date,
          routine_slot_id: slot.id,
          section_id: slot.section_id,
          period_slot_id: slot.period_slot_id,
          weekday: slot.weekday,
          subject_id: slot.subject_id,
          room_id: slot.room_id,
          kind,
          teacher_ids: substituted ? [sub!.substitute_teacher_id as string] : ownTeacherIds,
          substituted,
          cancelled,
          ...(substituted ? { substitute_teacher_id: sub!.substitute_teacher_id as string } : {}),
          ...(substituted ? { covering_for_teacher_ids: ownTeacherIds } : {}),
        });
      }
    }

    return results.sort((a, b) => a.date.localeCompare(b.date) || a.weekday - b.weekday);
  }

  private async resolveStudentSection(
    query: ResolveRoutineQueryDto,
    tenantId: string,
  ): Promise<string | null> {
    if (!query.student_id) return null;
    const enrollment = await this.enrollmentRepo.findOne({
      where: {
        student_id: query.student_id,
        tenant_id: tenantId,
        enrollment_status: EnrollmentStatus.ACTIVE,
      },
      order: { enrolled_at: 'DESC' },
    });
    return enrollment?.section_id ?? null;
  }
}
