import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Routine } from './entities/routine.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { RoutineSlotTeacher } from './entities/routine-slot-teacher.entity';

export interface TeacherWorkload {
  teacher_id: string;
  periods_per_week: number;
  periods_per_day: Record<number, number>;
}

/**
 * D19: read-only workload counts for the routine builder — per teacher,
 * how many periods a week and per weekday, aggregated from
 * `routine_slot_teachers`. Structural (counts currently-active slot
 * rows), not date-resolved — unlike `ResolveRoutineService`, this isn't
 * answering "what happens on date X", it's "how full is this teacher's
 * grid right now", so it deliberately doesn't go through the D14
 * resolver.
 *
 * A co-taught slot (more than one row in `routine_slot_teachers` for the
 * same slot) counts toward *every* teacher on it, not just the first —
 * that's simply what grouping by `teacher_id` naturally does, not a
 * special case.
 */
@Injectable()
export class WorkloadService {
  constructor(
    @InjectRepository(Routine) private readonly routineRepo: Repository<Routine>,
    @InjectRepository(RoutineSlot) private readonly slotRepo: Repository<RoutineSlot>,
    @InjectRepository(RoutineSlotTeacher)
    private readonly slotTeacherRepo: Repository<RoutineSlotTeacher>,
  ) {}

  async forRoutine(routineId: string, tenantId: string): Promise<TeacherWorkload[]> {
    const routine = await this.routineRepo.findOne({
      where: { id: routineId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!routine) {
      throw new NotFoundException(`Routine ID "${routineId}" not found`);
    }

    const activeSlots = await this.slotRepo.find({
      where: { routine_id: routineId, tenant_id: tenantId, valid_to: IsNull() },
    });
    if (activeSlots.length === 0) return [];

    const weekdayBySlot = new Map(activeSlots.map((s) => [s.id, s.weekday]));
    const teacherRows = await this.slotTeacherRepo.find({
      where: { routine_slot_id: In(activeSlots.map((s) => s.id)), tenant_id: tenantId },
    });

    const byTeacher = new Map<string, TeacherWorkload>();
    for (const row of teacherRows) {
      const weekday = weekdayBySlot.get(row.routine_slot_id);
      if (weekday === undefined) continue;

      const entry = byTeacher.get(row.teacher_id) ?? {
        teacher_id: row.teacher_id,
        periods_per_week: 0,
        periods_per_day: {},
      };
      entry.periods_per_week += 1;
      entry.periods_per_day[weekday] = (entry.periods_per_day[weekday] ?? 0) + 1;
      byTeacher.set(row.teacher_id, entry);
    }

    return Array.from(byTeacher.values()).sort((a, b) => a.teacher_id.localeCompare(b.teacher_id));
  }
}
