import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { Routine } from './entities/routine.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { RoutineSlotTeacher } from './entities/routine-slot-teacher.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { Room } from './entities/room.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';
import { SchoolsService } from '../schools/schools.service';
import { AuditService } from '../audit/audit.service';
import { localToday } from '../attendance/attendance-policy.util';
import { AuditAction, RoutineState, SlotRecurrence } from '@biddaloy/shared';
import { UpsertRoutineSlotDto } from './dto/routine-slots.dto';
import { checkSlot, SlotLike, Violation, Warning } from './constraint-check';

export interface RoutineSlotWithWarnings {
  slot: RoutineSlot;
  teacher_ids: string[];
  warnings: Warning[];
}

/** [21.4.1] Writes into `routine_slots`/`routine_slot_teachers`. Every
 * write re-runs `constraint-check.ts` server-side (D9/D10) — a client
 * grid may pre-check for UX, but this service is the only authority.
 *
 * D4 effective dating: `update()` never mutates a row's `weekday`,
 * `section_id` etc in place. It closes the existing row (`valid_to` set
 * to the day before the new row's `valid_from`) and inserts a new one —
 * the old row stays readable with its original dates, the way a mid-year
 * subject swap or teacher change actually happened in time.
 *
 * D16: no cascading collection saves. `RoutineSlot` carries no
 * `@OneToMany` to `RoutineSlotTeacher`; teacher rows are written through
 * `slotTeacherRepo` directly, never by attaching a collection to a
 * `RoutineSlot` and calling `save()` on it.
 */
@Injectable()
export class RoutineSlotsService {
  constructor(
    @InjectRepository(Routine) private readonly routineRepo: Repository<Routine>,
    @InjectRepository(RoutineSlot) private readonly slotRepo: Repository<RoutineSlot>,
    @InjectRepository(RoutineSlotTeacher)
    private readonly slotTeacherRepo: Repository<RoutineSlotTeacher>,
    @InjectRepository(PeriodSlot) private readonly periodSlotRepo: Repository<PeriodSlot>,
    @InjectRepository(TeacherClassSection)
    private readonly tcsRepo: Repository<TeacherClassSection>,
    private readonly settingsReader: SchoolSettingsReader,
    private readonly dataSource: DataSource,
    private readonly schoolsService: SchoolsService,
    private readonly auditService: AuditService,
  ) {}

  private async today(tenantId: string): Promise<string> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    return localToday(settings.region?.timezone ?? 'UTC');
  }

  async findForRoutine(routineId: string, tenantId: string): Promise<RoutineSlotWithWarnings[]> {
    await this.getRoutine(routineId, tenantId);
    const slots = await this.slotRepo.find({
      where: { routine_id: routineId, tenant_id: tenantId },
      order: { weekday: 'ASC' },
    });
    const teacherRows = await this.loadTeacherRows(
      slots.map((s) => s.id),
      tenantId,
    );
    return slots.map((slot) => ({
      slot,
      teacher_ids: teacherRows.get(slot.id) ?? [],
      warnings: [],
    }));
  }

  async create(
    routineId: string,
    dto: UpsertRoutineSlotDto,
    tenantId: string,
    actorUserId: string | null = null,
  ): Promise<RoutineSlotWithWarnings> {
    const routine = await this.getRoutine(routineId, tenantId);
    await this.assertNotBackdated(routine, dto.valid_from, tenantId);

    return this.dataSource.transaction(async (manager) => {
      await this.validateTenantReferences(manager, dto, tenantId);
      const periodSlot = await this.getPeriodSlot(dto.period_slot_id, tenantId, manager);
      const existing = await this.loadExisting(routineId, tenantId, manager, dto, actorUserId);
      const candidate = this.toSlotLike(dto, periodSlot);

      const { violations, warnings } = await this.check(candidate, existing, periodSlot, tenantId);
      if (violations.length > 0) {
        // [21.8.1] `details` (not a bare top-level `violations` key) is
        // what `error-response.ts`'s `resolveDetails` actually forwards to
        // the client — a plain key here was silently dropped, so the grid
        // builder's conflict list had nothing to render. Fixed here rather
        // than worked around client-side since every caller of this 409
        // needs the same fix.
        throw new ConflictException({
          message: 'Slot violates hard constraints',
          details: { violations },
        });
      }

      const saved = await this.persist(routineId, tenantId, dto, manager);
      return { slot: saved, teacher_ids: dto.teacher_ids, warnings };
    });
  }

  /**
   * D4: closes the row being replaced, then inserts a fresh one carrying
   * the new dto. The old row's id is never reused. Close, validation,
   * slot insertion and teacher-row insertion all run in one transaction —
   * a failure at any step rolls every one of them back together, so
   * there's no manual "undo the close" path to keep in sync.
   */
  async update(
    id: string,
    dto: UpsertRoutineSlotDto,
    tenantId: string,
    userId: string | null,
  ): Promise<RoutineSlotWithWarnings> {
    return this.dataSource.transaction(async (manager) => {
      const oldSlot = await manager.findOne(RoutineSlot, { where: { id, tenant_id: tenantId } });
      if (!oldSlot) {
        throw new NotFoundException(`Routine slot with ID "${id}" not found`);
      }

      const routine = await manager.findOne(Routine, {
        where: { id: oldSlot.routine_id, tenant_id: tenantId },
      });
      await this.assertNotBackdated(routine, dto.valid_from, tenantId);

      // D4 effective dating only makes sense moving forward from the old
      // row's own `valid_from` — otherwise the new row's `valid_to`
      // (computed below as the day before `dto.valid_from`) ends up
      // before its `valid_from`, an empty/invalid range.
      if (dto.valid_from <= oldSlot.valid_from) {
        throw new BadRequestException("valid_from must be after the current row's valid_from");
      }
      // The old row may already have been closed by an earlier edit
      // (`valid_to` set) — don't silently reopen/overwrite that.
      if (oldSlot.valid_to !== null && oldSlot.valid_to < dto.valid_from) {
        throw new ConflictException(`Routine slot was already superseded on ${oldSlot.valid_to}`);
      }

      await this.validateTenantReferences(manager, dto, tenantId);
      const periodSlot = await this.getPeriodSlot(dto.period_slot_id, tenantId, manager);
      const closeDate = dayBefore(dto.valid_from);

      // Close the old row first so the overlap check below sees it as
      // already ended.
      await manager.update(RoutineSlot, { id, tenant_id: tenantId }, { valid_to: closeDate });

      const existing = await this.loadExisting(oldSlot.routine_id, tenantId, manager, dto, userId);
      const candidate = this.toSlotLike(dto, periodSlot);

      const { violations, warnings } = await this.check(candidate, existing, periodSlot, tenantId);
      if (violations.length > 0) {
        // [21.8.1] Same fix as `create()` above — `details` (not a bare
        // top-level `violations` key) is what `resolveDetails` forwards
        // to the client, so an edit's conflict list rendered nothing
        // without this.
        throw new ConflictException({
          message: 'Slot violates hard constraints',
          details: { violations },
        });
      }

      const saved = await this.persist(oldSlot.routine_id, tenantId, dto, manager);
      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'RoutineSlot',
          entity_id: oldSlot.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          old_values: slotAuditValues(oldSlot),
          new_values: { new_slot_id: saved.id, valid_from: dto.valid_from, valid_to: closeDate },
        },
        manager,
      );
      return { slot: saved, teacher_ids: dto.teacher_ids, warnings };
    });
  }

  /** IDOR guard: every foreign id in the payload must resolve to a row
   * in this tenant, not just exist somewhere in the database. */
  private async validateTenantReferences(
    manager: EntityManager,
    dto: UpsertRoutineSlotDto,
    tenantId: string,
  ): Promise<void> {
    const [section, subject, room, teachers] = await Promise.all([
      manager.findOne(ClassSection, { where: { id: dto.section_id, tenant_id: tenantId } }),
      manager.findOne(Subject, { where: { id: dto.subject_id, tenant_id: tenantId } }),
      dto.room_id
        ? manager.findOne(Room, { where: { id: dto.room_id, tenant_id: tenantId } })
        : Promise.resolve(null),
      manager.find(Teacher, { where: { id: In(dto.teacher_ids), tenant_id: tenantId } }),
    ]);

    if (!section) throw new NotFoundException(`Section with ID "${dto.section_id}" not found`);
    if (!subject) throw new NotFoundException(`Subject with ID "${dto.subject_id}" not found`);
    if (dto.room_id && !room) {
      throw new NotFoundException(`Room with ID "${dto.room_id}" not found`);
    }

    const teacherIds = new Set(teachers.map((teacher) => teacher.id));
    if (dto.teacher_ids.some((teacherId) => !teacherIds.has(teacherId))) {
      throw new NotFoundException('One or more teacher IDs were not found');
    }
  }

  /**
   * TIME-08: on a PUBLISHED routine a slot that has already been in effect
   * is end-dated (`valid_to = yesterday`), never deleted — a delete would
   * erase it from every past date and cascade-delete its substitutions
   * and change requests. Drafts, and slots that never became active,
   * are hard-deleted as before. Every remove writes an audit row.
   */
  async remove(id: string, tenantId: string, userId: string | null): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const slot = await manager.findOne(RoutineSlot, { where: { id, tenant_id: tenantId } });
      if (!slot) {
        throw new NotFoundException(`Routine slot with ID "${id}" not found`);
      }
      const routine = await this.getRoutine(slot.routine_id, tenantId);
      const today = await this.today(tenantId);
      const published = routine.state === RoutineState.PUBLISHED;

      if (published && slot.valid_from < today) {
        if (slot.valid_to !== null && slot.valid_to < today) {
          throw new ConflictException({
            message: 'This slot has already ended',
            details: { code: 'ROUTINE_SLOT_ALREADY_ENDED' },
          });
        }
        const valid_to = dayBefore(today);
        await manager.update(RoutineSlot, { id, tenant_id: tenantId }, { valid_to });
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'RoutineSlot',
            entity_id: id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            old_values: slotAuditValues(slot),
            new_values: { valid_to },
          },
          manager,
        );
        return;
      }

      // Explicit child-row delete (D16) — FK is ON DELETE CASCADE too, this
      // just makes the intent visible rather than relying on it silently.
      await manager.delete(RoutineSlotTeacher, { routine_slot_id: id, tenant_id: tenantId });
      await manager.delete(RoutineSlot, { id, tenant_id: tenantId });
      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'RoutineSlot',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          old_values: slotAuditValues(slot),
          new_values: null,
        },
        manager,
      );
    });
  }

  // --- internals ---

  /** TIME-08: a published routine's history is what the school answers
   * "what was the timetable on 3 March?" from, so a new or edited slot may
   * only take effect from today onwards. */
  private async assertNotBackdated(
    routine: Routine | null,
    validFrom: string,
    tenantId: string,
  ): Promise<void> {
    if (routine?.state === RoutineState.PUBLISHED && validFrom < (await this.today(tenantId))) {
      throw new UnprocessableEntityException({
        message: 'A change to a published routine can take effect today at the earliest',
        details: { code: 'ROUTINE_SLOT_BACKDATED' },
      });
    }
  }

  private async getRoutine(routineId: string, tenantId: string): Promise<Routine> {
    const routine = await this.routineRepo.findOne({
      where: { id: routineId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!routine) {
      throw new NotFoundException(`Routine with ID "${routineId}" not found`);
    }
    return routine;
  }

  private async getPeriodSlot(
    periodSlotId: string,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<PeriodSlot> {
    const repo = manager ? manager.getRepository(PeriodSlot) : this.periodSlotRepo;
    // Inside a transaction (`create()`/`update()`), take a read lock on
    // the period-slot row so it can't be deleted out from under this
    // transaction by a concurrent `PeriodSlotsService.replaceForShift`,
    // which takes a `pessimistic_write` lock on the same row before its
    // own reference count.
    const periodSlot = await repo.findOne({
      where: { id: periodSlotId, tenant_id: tenantId },
      ...(manager ? { lock: { mode: 'pessimistic_read' as const } } : {}),
    });
    if (!periodSlot) {
      throw new NotFoundException(`Period slot with ID "${periodSlotId}" not found`);
    }
    return periodSlot;
  }

  private async loadTeacherRows(
    slotIds: string[],
    tenantId: string,
    manager?: EntityManager,
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (slotIds.length === 0) return map;
    const repo = manager ? manager.getRepository(RoutineSlotTeacher) : this.slotTeacherRepo;
    const rows = await repo.find({
      where: { routine_slot_id: In(slotIds), tenant_id: tenantId },
    });
    for (const row of rows) {
      const list = map.get(row.routine_slot_id) ?? [];
      list.push(row.teacher_id);
      map.set(row.routine_slot_id, list);
    }
    return map;
  }

  /** Every active-or-future slot in the routine, as `SlotLike`, with
   * teacher assignments and period sequence attached — what a candidate
   * is checked against. */
  private async loadExisting(
    routineId: string,
    tenantId: string,
    manager?: EntityManager,
    candidate?: UpsertRoutineSlotDto,
    actorUserId?: string | null,
  ): Promise<SlotLike[]> {
    const foreign =
      manager && candidate && actorUserId
        ? await this.loadForeignTeacherSlots(manager, tenantId, actorUserId, candidate.teacher_ids)
        : [];
    const local = await this.loadLocalSlots(routineId, tenantId, manager);
    return [...local, ...foreign];
  }

  /** [58.0.03] D12: slots of the same people in OTHER branches. One query.
   * Membership is part of the join, so a branch the actor is not a live
   * member of is never read. Returns clock times and names only, no
   * section/subject/room/class data. */
  private async loadForeignTeacherSlots(
    manager: EntityManager,
    tenantId: string,
    actorUserId: string,
    teacherIds: string[],
  ): Promise<SlotLike[]> {
    if (teacherIds.length === 0) return [];
    const rows: Array<{
      id: string;
      local_teacher_id: string;
      weekday: number;
      recurrence: SlotRecurrence;
      recurrence_offset: number;
      valid_from: string;
      valid_to: string | null;
      starts_at: string;
      ends_at: string;
      period_name: string | null;
      tenant_name: string;
    }> = await manager.query(
      `SELECT rs.id, lt.id AS local_teacher_id, rs.weekday, rs.recurrence, rs.recurrence_offset,
              rs.valid_from::text AS valid_from, rs.valid_to::text AS valid_to,
              ps.starts_at, ps.ends_at, ps.name AS period_name, sch.name AS tenant_name
         FROM teachers lt
         JOIN teachers ft ON ft.user_id = lt.user_id AND ft.tenant_id <> lt.tenant_id AND ft.deleted_at IS NULL
                  JOIN routine_slot_teachers rst ON rst.teacher_id = ft.id AND rst.tenant_id = ft.tenant_id
         JOIN routine_slots rs ON rs.id = rst.routine_slot_id AND rs.tenant_id = ft.tenant_id
         JOIN routines r ON r.id = rs.routine_id AND r.tenant_id = ft.tenant_id AND r.deleted_at IS NULL
         JOIN academic_years ay ON ay.id = r.academic_year_id AND ay.tenant_id = ft.tenant_id
              AND ay.is_current = true AND ay.deleted_at IS NULL
         JOIN period_slots ps ON ps.id = rs.period_slot_id AND ps.tenant_id = ft.tenant_id
         JOIN schools sch ON sch.id = ft.tenant_id AND sch.deleted_at IS NULL
        WHERE lt.tenant_id = $1 AND lt.id = ANY($3::uuid[])
          AND EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = $2
                       AND ut.tenant_id = ft.tenant_id AND ut.deleted_at IS NULL)`,
      [tenantId, actorUserId, teacherIds],
    );
    return rows.map((r) => ({
      id: r.id,
      section_id: '',
      period_slot_id: '',
      period_sequence: 0,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      weekday: r.weekday,
      subject_id: '',
      room_id: null,
      recurrence: r.recurrence,
      recurrence_offset: r.recurrence_offset,
      valid_from: r.valid_from,
      valid_to: r.valid_to,
      teacher_ids: [r.local_teacher_id],
      foreign: { tenantName: r.tenant_name, periodName: r.period_name },
    }));
  }

  private async loadLocalSlots(
    routineId: string,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<SlotLike[]> {
    const slotRepo = manager ? manager.getRepository(RoutineSlot) : this.slotRepo;
    const periodSlotRepo = manager ? manager.getRepository(PeriodSlot) : this.periodSlotRepo;
    const slots = await slotRepo.find({
      where: { routine_id: routineId, tenant_id: tenantId },
    });
    if (slots.length === 0) return [];
    const periodSlotIds = Array.from(new Set(slots.map((s) => s.period_slot_id)));
    const periodSlots = await periodSlotRepo.find({
      where: { id: In(periodSlotIds), tenant_id: tenantId },
    });
    const sequenceById = new Map(periodSlots.map((p) => [p.id, p.sequence]));
    const timesById = new Map(
      periodSlots.map((p) => [p.id, { starts_at: p.starts_at, ends_at: p.ends_at }]),
    );
    const teacherRows = await this.loadTeacherRows(
      slots.map((s) => s.id),
      tenantId,
      manager,
    );
    return slots.map((s) => ({
      id: s.id,
      section_id: s.section_id,
      period_slot_id: s.period_slot_id,
      period_sequence: sequenceById.get(s.period_slot_id) ?? 0,
      starts_at: timesById.get(s.period_slot_id)?.starts_at ?? '00:00',
      ends_at: timesById.get(s.period_slot_id)?.ends_at ?? '00:00',
      weekday: s.weekday,
      subject_id: s.subject_id,
      room_id: s.room_id,
      recurrence: s.recurrence,
      recurrence_offset: s.recurrence_offset,
      valid_from: s.valid_from,
      valid_to: s.valid_to,
      teacher_ids: teacherRows.get(s.id) ?? [],
    }));
  }

  private toSlotLike(dto: UpsertRoutineSlotDto, periodSlot: PeriodSlot): SlotLike {
    return {
      section_id: dto.section_id,
      period_slot_id: dto.period_slot_id,
      period_sequence: periodSlot.sequence,
      starts_at: periodSlot.starts_at,
      ends_at: periodSlot.ends_at,
      weekday: dto.weekday,
      subject_id: dto.subject_id,
      room_id: dto.room_id ?? null,
      recurrence: dto.recurrence,
      recurrence_offset: dto.recurrence_offset ?? 0,
      valid_from: dto.valid_from,
      valid_to: dto.valid_to ?? null,
      teacher_ids: dto.teacher_ids,
    };
  }

  private async check(
    candidate: SlotLike,
    existing: SlotLike[],
    periodSlot: PeriodSlot,
    tenantId: string,
  ): Promise<{ violations: Violation[]; warnings: Warning[] }> {
    const [settings, tcsRows] = await Promise.all([
      this.settingsReader.routineSettings(tenantId),
      this.tcsRepo.find({
        where: {
          tenant_id: tenantId,
          teacher_id: In(candidate.teacher_ids),
          section_id: candidate.section_id,
        },
      }),
    ]);
    const assignedSections = new Set(
      tcsRows
        .filter((r) => r.subject_id === null || r.subject_id === candidate.subject_id)
        .map((r) => r.teacher_id),
    );
    return checkSlot(
      candidate,
      existing,
      { id: periodSlot.id, kind: periodSlot.kind },
      assignedSections,
      settings,
    );
  }

  private async persist(
    routineId: string,
    tenantId: string,
    dto: UpsertRoutineSlotDto,
    manager: EntityManager,
  ): Promise<RoutineSlot> {
    const slotRepo = manager.getRepository(RoutineSlot);
    const slotTeacherRepo = manager.getRepository(RoutineSlotTeacher);
    const entity = slotRepo.create({
      routine_id: routineId,
      tenant_id: tenantId,
      section_id: dto.section_id,
      period_slot_id: dto.period_slot_id,
      weekday: dto.weekday,
      subject_id: dto.subject_id,
      room_id: dto.room_id ?? null,
      recurrence: dto.recurrence,
      recurrence_offset: dto.recurrence_offset ?? 0,
      valid_from: dto.valid_from,
      valid_to: dto.valid_to ?? null,
    });
    const saved = await slotRepo.save(entity);

    // Explicit child-row writes (D16) — never a collection on `saved`.
    const teacherRows = dto.teacher_ids.map((teacherId) =>
      slotTeacherRepo.create({
        routine_slot_id: saved.id,
        tenant_id: tenantId,
        teacher_id: teacherId,
      }),
    );
    await slotTeacherRepo.save(teacherRows);

    return saved;
  }
}

/** `'YYYY-MM-DD'` minus one calendar day, as a `'YYYY-MM-DD'` string. */
function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function slotAuditValues(slot: RoutineSlot): Record<string, unknown> {
  return {
    valid_from: slot.valid_from,
    valid_to: slot.valid_to,
    section_id: slot.section_id,
    subject_id: slot.subject_id,
    period_slot_id: slot.period_slot_id,
  };
}
