import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { RoutineSubstitution } from './entities/routine-substitution.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { Routine } from './entities/routine.entity';
import { RoutineSlotTeacher } from './entities/routine-slot-teacher.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { TeacherBusyService } from './teacher-busy.service';
import { SchoolsService } from '../schools/schools.service';
import { periodTimesOn, resolveAttendancePolicy } from '../attendance/attendance-policy.util';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { UpsertSubstitutionDto, QuerySubstitutionsDto } from './dto/substitution.dto';
import { occursOn } from './recurrence';
import { attentionEvents } from '../attention/attention.constants';
import { emitRecheck } from '../attention/engine/attention-events';

/** What the log shows about a row's slot, from any year (`null` if it is gone). */
export interface SubstitutionSlotSummary {
  section_id: string;
  class_name: string;
  section_name: string;
  period_sequence: number;
  starts_at: string;
  subject_name_en: string;
  subject_name_bn: string | null;
  teacher_ids: string[];
}
export type SubstitutionLogRow = RoutineSubstitution & { slot: SubstitutionSlotSummary | null };

/**
 * [21.5.1] Substitutions CRUD (`ROUTINE_MANAGE`, enforced by the
 * controller). D12: a substitution is a dated overlay row in
 * `routine_substitutions` — it never writes to `routine_slots`. One row
 * per `(routine_slot_id, date)`; recording a second one for the same pair
 * corrects the first row in place rather than creating a duplicate.
 */
@Injectable()
export class SubstitutionsService {
  constructor(
    @InjectRepository(RoutineSubstitution)
    private readonly substitutionRepo: Repository<RoutineSubstitution>,
    @InjectRepository(RoutineSlot) private readonly slotRepo: Repository<RoutineSlot>,
    @InjectRepository(Routine) private readonly routineRepo: Repository<Routine>,
    @InjectRepository(AcademicYear) private readonly yearRepo: Repository<AcademicYear>,
    @InjectRepository(Teacher) private readonly teacherRepo: Repository<Teacher>,
    @InjectRepository(RoutineSlotTeacher)
    private readonly slotTeacherRepo: Repository<RoutineSlotTeacher>,
    @InjectRepository(PeriodSlot) private readonly periodSlotRepo: Repository<PeriodSlot>,
    private readonly teacherBusy: TeacherBusyService,
    private readonly schools: SchoolsService,
    private readonly auditService: AuditService,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Subject) private readonly subjectRepo: Repository<Subject>,
  ) {}

  async record(
    dto: UpsertSubstitutionDto,
    tenantId: string,
    userId: string,
  ): Promise<RoutineSubstitution> {
    const slot = await this.slotRepo.findOne({
      where: { id: dto.routine_slot_id, tenant_id: tenantId },
    });
    if (!slot) {
      throw new NotFoundException(`Routine slot with ID "${dto.routine_slot_id}" not found`);
    }

    // IDOR guard: `dto.substitute_teacher_id` is caller-controlled and
    // otherwise flows straight into the write below — validate it
    // resolves to a teacher in this tenant, not just anywhere.
    let substituteUserId: string | null = null;
    if (dto.substitute_teacher_id) {
      const teacher = await this.teacherRepo.findOne({
        where: { id: dto.substitute_teacher_id, tenant_id: tenantId },
      });
      if (!teacher) {
        throw new NotFoundException(`Teacher with ID "${dto.substitute_teacher_id}" not found`);
      }
      substituteUserId = teacher.user_id;
    }

    await this.assertSlotOccursOn(slot, dto.date, tenantId);
    if (substituteUserId && !dto.is_cancelled) {
      await this.assertSubstituteFree(slot, substituteUserId, dto, tenantId, userId);
    }

    const values = {
      routine_slot_id: dto.routine_slot_id,
      tenant_id: tenantId,
      date: dto.date,
      substitute_teacher_id: dto.substitute_teacher_id ?? null,
      is_cancelled: dto.is_cancelled ?? false,
      reason: dto.reason ?? null,
      created_by: userId,
    };

    // Concurrent requests for the same (routine_slot_id, date) can both
    // miss on a separate existence check, then both try to insert and
    // one hits the unique index — retry that one as an update instead of
    // surfacing a raw DB error.
    let saved: RoutineSubstitution;
    try {
      saved = await this.substitutionRepo.save(this.substitutionRepo.create(values));
    } catch (err) {
      if (!this.isUniqueViolation(err)) throw err;
      await this.substitutionRepo.update(
        { routine_slot_id: dto.routine_slot_id, date: dto.date, tenant_id: tenantId },
        values,
      );
      saved = (await this.substitutionRepo.findOne({
        where: { routine_slot_id: dto.routine_slot_id, date: dto.date, tenant_id: tenantId },
      }))!;
    }
    emitRecheck(attentionEvents, {
      tenantId,
      ruleKey: 'routine.substitution_today',
      actorUserId: userId,
    });
    emitRecheck(attentionEvents, {
      tenantId,
      ruleKey: 'routine.changed_today',
      actorUserId: userId,
    });
    return saved;
  }

  /** Delete one substitution row: the slot goes back to its usual teacher on
   * that date. `routine_substitutions` has no child FKs. */
  async remove(id: string, tenantId: string, userId: string): Promise<void> {
    const row = await this.substitutionRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!row) {
      throw new NotFoundException('Substitution not found');
    }
    await this.substitutionRepo.delete({ id, tenant_id: tenantId });
    await this.auditService.record({
      action: AuditAction.DELETE,
      // `RoutineSubstitution` is not in the shared audit catalog (outside this
      // lane), so the row is logged against the slot it overlays.
      entity_type: 'RoutineSlot',
      entity_id: row.routine_slot_id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      old_values: {
        substitution_id: id,
        routine_slot_id: row.routine_slot_id,
        date: row.date,
        substitute_teacher_id: row.substitute_teacher_id,
        is_cancelled: row.is_cancelled,
      },
      new_values: null,
    });
    emitRecheck(attentionEvents, {
      tenantId,
      ruleKey: 'routine.substitution_today',
      actorUserId: userId,
    });
    emitRecheck(attentionEvents, {
      tenantId,
      ruleKey: 'routine.changed_today',
      actorUserId: userId,
    });
  }

  /** TEN-07: the cover must not be the slot's own teacher, nor busy then. */
  private async assertSubstituteFree(
    slot: RoutineSlot,
    substituteUserId: string,
    dto: UpsertSubstitutionDto,
    tenantId: string,
    actorUserId: string,
  ) {
    const own = await this.slotTeacherRepo.find({
      where: { routine_slot_id: slot.id, tenant_id: tenantId },
    });
    if (own.some((r) => r.teacher_id === dto.substitute_teacher_id)) {
      throw new ConflictException({
        message: "The substitute is already this slot's teacher",
        details: { code: 'SUBSTITUTE_IS_SLOT_TEACHER' },
      });
    }
    const period = await this.periodSlotRepo.findOne({
      where: { id: slot.period_slot_id, tenant_id: tenantId },
    });
    if (!period) return;
    // The period's times on that date: a special timing (e.g. Ramadan) can move it.
    const { starts_at, ends_at } = periodTimesOn(
      resolveAttendancePolicy(await this.schools.getResolvedSettings(tenantId)),
      period,
      dto.date,
    );
    const clash = await this.teacherBusy.busyAt({
      tenantId,
      userId: substituteUserId,
      date: dto.date,
      from: starts_at.slice(0, 5),
      to: ends_at.slice(0, 5),
      actorUserId,
      exclude: { routineSlotId: slot.id },
    });
    if (clash) {
      throw new ConflictException({
        message: 'This teacher is not free at that time',
        details: {
          code: 'TEACHER_BUSY',
          kind: clash.kind,
          tenantName: clash.tenantName,
          from: clash.from,
          to: clash.to,
        },
      });
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23505'
    );
  }

  async list(query: QuerySubstitutionsDto, tenantId: string): Promise<SubstitutionLogRow[]> {
    const qb = this.substitutionRepo
      .createQueryBuilder('sub')
      .innerJoin('sub.routine_slot', 'slot')
      .where('sub.tenant_id = :tenantId', { tenantId });

    if (query.from) qb.andWhere('sub.date >= :from', { from: query.from });
    if (query.to) qb.andWhere('sub.date <= :to', { to: query.to });
    if (query.substitute_teacher_id) {
      qb.andWhere('sub.substitute_teacher_id = :subTeacher', {
        subTeacher: query.substitute_teacher_id,
      });
    }
    if (query.section_id) {
      qb.andWhere('slot.section_id = :sectionId', { sectionId: query.section_id });
    }
    if (query.covered_for_teacher_id) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM routine_slot_teachers rst WHERE rst.routine_slot_id = slot.id AND rst.teacher_id = :coveredFor)',
        { coveredFor: query.covered_for_teacher_id },
      );
    }

    const rows = await qb.orderBy('sub.date', 'DESC').getMany();
    return this.withSlotSummaries(rows, tenantId);
  }

  /** Batch-loads each row's slot context (no per-row query, no year filter), so
   * rows from an earlier year still show their period, section and teachers. */
  private async withSlotSummaries(
    rows: RoutineSubstitution[],
    tenantId: string,
  ): Promise<SubstitutionLogRow[]> {
    if (rows.length === 0) return [];
    const slots = await this.slotRepo.find({
      where: { tenant_id: tenantId, id: In([...new Set(rows.map((r) => r.routine_slot_id))]) },
    });
    const slotById = new Map(slots.map((slot) => [slot.id, slot]));
    const [periods, sections, subjects, slotTeachers] = await Promise.all([
      this.periodSlotRepo.find({
        where: { tenant_id: tenantId, id: In([...new Set(slots.map((s) => s.period_slot_id))]) },
      }),
      this.sectionRepo.find({
        where: { tenant_id: tenantId, id: In([...new Set(slots.map((s) => s.section_id))]) },
        relations: { class: true },
        withDeleted: true,
      }),
      this.subjectRepo.find({
        where: { tenant_id: tenantId, id: In([...new Set(slots.map((s) => s.subject_id))]) },
        withDeleted: true,
      }),
      this.slotTeacherRepo.find({
        where: { tenant_id: tenantId, routine_slot_id: In(slots.map((s) => s.id)) },
      }),
    ]);
    const periodById = new Map(periods.map((p) => [p.id, p]));
    const sectionById = new Map(sections.map((sec) => [sec.id, sec]));
    const subjectById = new Map(subjects.map((subj) => [subj.id, subj]));

    return rows.map((row) => {
      const slot = slotById.get(row.routine_slot_id);
      const period = slot && periodById.get(slot.period_slot_id);
      const section = slot && sectionById.get(slot.section_id);
      const subject = slot && subjectById.get(slot.subject_id);
      if (!slot || !period || !section || !subject) return Object.assign(row, { slot: null });
      return Object.assign(row, {
        slot: {
          section_id: slot.section_id,
          class_name: section.class?.name ?? '',
          section_name: section.section_name,
          period_sequence: period.sequence,
          starts_at: period.starts_at,
          subject_name_en: subject.name_en,
          subject_name_bn: subject.name_bn,
          teacher_ids: slotTeachers
            .filter((st) => st.routine_slot_id === slot.id)
            .map((st) => st.teacher_id),
        },
      });
    });
  }

  /** Refuse a substitution on a date the slot doesn't actually occur on —
   * a sign the caller has the wrong slot. */
  private async assertSlotOccursOn(slot: RoutineSlot, date: string, tenantId: string) {
    const validTo = slot.valid_to ?? '9999-12-31';
    const routine = await this.routineRepo.findOne({
      where: { id: slot.routine_id, tenant_id: tenantId },
    });
    const academicYear = routine
      ? await this.yearRepo.findOne({
          where: { id: routine.academic_year_id, tenant_id: tenantId },
        })
      : null;

    const inRange = date >= slot.valid_from && date <= validTo;
    const matchesRecurrence =
      academicYear && occursOn(slot, date, academicYear.start_date as unknown as string);

    if (!inRange || !matchesRecurrence) {
      // `details.code` lets the SPA tell this apart from any other 422.
      throw new UnprocessableEntityException({
        message: `Routine slot "${slot.id}" does not occur on ${date}`,
        details: { code: 'SLOT_NOT_ON_DATE' },
      });
    }
  }
}
