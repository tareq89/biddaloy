import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Routine } from './entities/routine.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { RoutineSlotTeacher } from './entities/routine-slot-teacher.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';
import { GreedyFillQueryDto } from './dto/routine-slots.dto';
import { checkSlot, SlotLike } from './constraint-check';
import { PeriodSlotKind, SlotRecurrence } from '@biddaloy/shared';

export interface ProposedSlot {
  section_id: string;
  period_slot_id: string;
  weekday: number;
  subject_id: string;
  teacher_ids: string[];
  recurrence: SlotRecurrence;
  recurrence_offset: number;
  valid_from: string;
  valid_to: string | null;
}

/**
 * [21.4.1] Fills empty grid cells for sections already present in a
 * routine — never touches a cell that already has a slot, and never
 * writes to the database itself; it returns a proposal list the client
 * reviews/edits before calling `RoutineSlotsService` to actually save
 * (D9: the write path re-runs `constraint-check.ts` again anyway, this
 * is a convenience proposer, not a second authority).
 *
 * Deterministic: same input (routine's existing slots, `TeacherClassSection`
 * rows, `RoutineSettings`) always produces the same proposal set — cells
 * are visited in a fixed order (section id, then weekday, then period
 * sequence) and candidate teachers in a fixed order (fewest periods
 * assigned so far, then teacher id), so a re-run of the exact same state
 * always proposes the same thing.
 */
@Injectable()
export class GreedyFillService {
  constructor(
    @InjectRepository(Routine) private readonly routineRepo: Repository<Routine>,
    @InjectRepository(RoutineSlot) private readonly slotRepo: Repository<RoutineSlot>,
    @InjectRepository(RoutineSlotTeacher)
    private readonly slotTeacherRepo: Repository<RoutineSlotTeacher>,
    @InjectRepository(PeriodSlot) private readonly periodSlotRepo: Repository<PeriodSlot>,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Class) private readonly classRepo: Repository<Class>,
    @InjectRepository(TeacherClassSection)
    private readonly tcsRepo: Repository<TeacherClassSection>,
    private readonly settingsReader: SchoolSettingsReader,
  ) {}

  async fill(
    routineId: string,
    dto: GreedyFillQueryDto,
    tenantId: string,
  ): Promise<ProposedSlot[]> {
    const routine = await this.routineRepo.findOne({
      where: { id: routineId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!routine) {
      throw new NotFoundException(`Routine with ID "${routineId}" not found`);
    }
    const weekdays = (
      dto.weekdays && dto.weekdays.length > 0 ? dto.weekdays : [0, 1, 2, 3, 4, 5, 6]
    )
      .slice()
      .sort((a, b) => a - b);

    const existingSlots = await this.slotRepo.find({
      where: { routine_id: routineId, tenant_id: tenantId },
    });
    if (existingSlots.length === 0) return [];

    const sectionIds = Array.from(new Set(existingSlots.map((s) => s.section_id))).sort();
    const sections = await this.sectionRepo.find({
      where: { id: In(sectionIds), tenant_id: tenantId },
    });
    const classIds = Array.from(new Set(sections.map((s) => s.class_id)));
    const classes = await this.classRepo.find({ where: { id: In(classIds), tenant_id: tenantId } });
    const shiftIdBySection = new Map(
      sections.map((s) => [s.id, classes.find((c) => c.id === s.class_id)?.shift_id ?? null]),
    );
    const shiftIds = Array.from(
      new Set(Array.from(shiftIdBySection.values()).filter((id): id is string => !!id)),
    );
    const periodSlots = shiftIds.length
      ? await this.periodSlotRepo.find({
          where: { shift_id: In(shiftIds), tenant_id: tenantId, kind: PeriodSlotKind.CLASS },
          order: { sequence: 'ASC' },
        })
      : [];
    const periodSlotsByShift = new Map<string, PeriodSlot[]>();
    for (const ps of periodSlots) {
      const list = periodSlotsByShift.get(ps.shift_id) ?? [];
      list.push(ps);
      periodSlotsByShift.set(ps.shift_id, list);
    }

    const teacherRows = await this.slotTeacherRepo.find({
      where: { routine_slot_id: In(existingSlots.map((s) => s.id)), tenant_id: tenantId },
    });
    const teacherIdsBySlot = new Map<string, string[]>();
    for (const row of teacherRows) {
      const list = teacherIdsBySlot.get(row.routine_slot_id) ?? [];
      list.push(row.teacher_id);
      teacherIdsBySlot.set(row.routine_slot_id, list);
    }
    const sequenceByPeriodSlotId = new Map(periodSlots.map((p) => [p.id, p.sequence]));
    const timesByPeriodSlotId = new Map(
      periodSlots.map((p) => [p.id, { starts_at: p.starts_at, ends_at: p.ends_at }]),
    );

    let existing: SlotLike[] = existingSlots.map((s) => ({
      id: s.id,
      section_id: s.section_id,
      period_slot_id: s.period_slot_id,
      period_sequence: sequenceByPeriodSlotId.get(s.period_slot_id) ?? 0,
      starts_at: timesByPeriodSlotId.get(s.period_slot_id)?.starts_at ?? '00:00',
      ends_at: timesByPeriodSlotId.get(s.period_slot_id)?.ends_at ?? '00:00',
      weekday: s.weekday,
      subject_id: s.subject_id,
      room_id: s.room_id,
      recurrence: s.recurrence,
      recurrence_offset: s.recurrence_offset,
      valid_from: s.valid_from,
      valid_to: s.valid_to,
      teacher_ids: teacherIdsBySlot.get(s.id) ?? [],
    }));

    const tcsRows = await this.tcsRepo.find({
      where: { tenant_id: tenantId, section_id: In(sectionIds) },
    });
    // section_id -> subject_id -> ordered candidate teacher ids (assigned
    // subject teachers only; class-teacher rows with subject_id null
    // don't propose a subject to teach).
    const candidatesBySection = new Map<string, Map<string, string[]>>();
    for (const row of tcsRows) {
      if (!row.subject_id) continue;
      const bySubject = candidatesBySection.get(row.section_id) ?? new Map<string, string[]>();
      const list = bySubject.get(row.subject_id) ?? [];
      list.push(row.teacher_id);
      bySubject.set(row.subject_id, list);
      candidatesBySection.set(row.section_id, bySubject);
    }

    const settings = await this.settingsReader.routineSettings(tenantId);
    const assignedSections = new Set(tcsRows.map((r) => r.teacher_id));
    const today = new Date().toISOString().slice(0, 10);
    // A D4-superseded slot (`valid_to` already in the past) is no longer in
    // force — same bug class `checkSlot`'s daily-cap/consecutive-period
    // checks had (see constraint-check.ts), fixed there via
    // `dateRangesOverlap`. Here there's no single "candidate" range to
    // overlap against, just "is this slot live today" — an inclusive
    // `[valid_from, valid_to]` containment check against `today`, matching
    // `dateRangesOverlap`'s endpoint-inclusive semantics.
    const isActiveToday = (s: SlotLike) =>
      s.valid_from <= today && (s.valid_to === null || today <= s.valid_to);
    const teacherPeriodCount = new Map<string, number>();
    for (const slot of existing) {
      if (!isActiveToday(slot)) continue;
      for (const t of slot.teacher_ids) {
        teacherPeriodCount.set(t, (teacherPeriodCount.get(t) ?? 0) + 1);
      }
    }

    const proposals: ProposedSlot[] = [];

    for (const sectionId of sectionIds) {
      const shiftId = shiftIdBySection.get(sectionId);
      const slots = shiftId ? (periodSlotsByShift.get(shiftId) ?? []) : [];
      const bySubject = candidatesBySection.get(sectionId);
      if (!bySubject) continue;
      const subjectIds = Array.from(bySubject.keys()).sort();

      for (const weekday of weekdays) {
        for (const periodSlot of slots) {
          const cellFilled = existing.some(
            (s) =>
              s.section_id === sectionId &&
              s.period_slot_id === periodSlot.id &&
              s.weekday === weekday &&
              isActiveToday(s),
          );
          if (cellFilled) continue;

          let placed = false;
          for (const subjectId of subjectIds) {
            const teacherIds = [...(bySubject.get(subjectId) ?? [])].sort(
              (a, b) =>
                (teacherPeriodCount.get(a) ?? 0) - (teacherPeriodCount.get(b) ?? 0) ||
                a.localeCompare(b),
            );
            for (const teacherId of teacherIds) {
              const candidate: SlotLike = {
                section_id: sectionId,
                period_slot_id: periodSlot.id,
                period_sequence: periodSlot.sequence,
                starts_at: periodSlot.starts_at,
                ends_at: periodSlot.ends_at,
                weekday,
                subject_id: subjectId,
                room_id: null,
                recurrence: SlotRecurrence.WEEKLY,
                recurrence_offset: 0,
                valid_from: today,
                valid_to: null,
                teacher_ids: [teacherId],
              };
              const { violations } = checkSlot(
                candidate,
                existing,
                { id: periodSlot.id, kind: periodSlot.kind },
                assignedSections,
                settings,
              );
              if (violations.length === 0) {
                proposals.push({
                  section_id: sectionId,
                  period_slot_id: periodSlot.id,
                  weekday,
                  subject_id: subjectId,
                  teacher_ids: [teacherId],
                  recurrence: SlotRecurrence.WEEKLY,
                  recurrence_offset: 0,
                  valid_from: today,
                  valid_to: null,
                });
                existing = [...existing, candidate];
                teacherPeriodCount.set(teacherId, (teacherPeriodCount.get(teacherId) ?? 0) + 1);
                placed = true;
                break;
              }
            }
            if (placed) break;
          }
        }
      }
    }

    return proposals;
  }
}
