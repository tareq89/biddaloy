import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
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
  ) {}

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
  ): Promise<RoutineSlotWithWarnings> {
    await this.getRoutine(routineId, tenantId);

    return this.dataSource.transaction(async (manager) => {
      await this.validateTenantReferences(manager, dto, tenantId);
      const periodSlot = await this.getPeriodSlot(dto.period_slot_id, tenantId, manager);
      const existing = await this.loadExisting(routineId, tenantId, manager);
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
  ): Promise<RoutineSlotWithWarnings> {
    return this.dataSource.transaction(async (manager) => {
      const oldSlot = await manager.findOne(RoutineSlot, { where: { id, tenant_id: tenantId } });
      if (!oldSlot) {
        throw new NotFoundException(`Routine slot with ID "${id}" not found`);
      }

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

      const existing = await this.loadExisting(oldSlot.routine_id, tenantId, manager);
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

  async remove(id: string, tenantId: string): Promise<void> {
    const slot = await this.slotRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!slot) {
      throw new NotFoundException(`Routine slot with ID "${id}" not found`);
    }
    // Explicit child-row delete (D16) — FK is ON DELETE CASCADE too, this
    // just makes the intent visible rather than relying on it silently.
    await this.slotTeacherRepo.delete({ routine_slot_id: id, tenant_id: tenantId });
    await this.slotRepo.delete({ id, tenant_id: tenantId });
  }

  // --- internals ---

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
