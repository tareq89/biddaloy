import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { PeriodSlotKind, RoutineState, SlotRecurrence } from '@biddaloy/shared';
import { Subject } from '../academics/entities/subject.entity';
import { Shift } from '../routines/entities/shift.entity';
import { PeriodSlot } from '../routines/entities/period-slot.entity';
import { Routine } from '../routines/entities/routine.entity';
import { RoutineSlot } from '../routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from '../routines/entities/routine-substitution.entity';

/**
 * Test-only: a PUBLISHED weekly routine for one section with periods 1..N, all
 * on the weekday of `date`, so that `date` resolves to N periods. The routine
 * tables are truncated before every test, so this is called per test.
 */
export async function seedPeriodRoutine(
  ds: DataSource,
  opts: {
    tenantId: string;
    academicYearId: string; // must cover `date`
    sectionId: string;
    date: string;
    periods: number;
    teacherId?: string; // the slot's own teacher
    createdBy: string; // a user id, for substitutions
    state?: RoutineState;
  },
) {
  const { tenantId, sectionId, date } = opts;
  const shift = await ds.getRepository(Shift).save({
    tenant_id: tenantId,
    name: `Shift-${randomUUID().slice(0, 6)}`,
    day_starts_at: '08:00',
    day_ends_at: '13:00',
    sequence: 0,
  });
  const routine = await ds.getRepository(Routine).save({
    tenant_id: tenantId,
    academic_year_id: opts.academicYearId,
    name: 'Fixture Routine',
    state: opts.state ?? RoutineState.PUBLISHED,
    published_at: new Date(),
  });
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const slots: Array<{ routineSlot: RoutineSlot; subject: Subject; periodSlot: PeriodSlot }> = [];
  for (let n = 1; n <= opts.periods; n++) {
    const periodSlot = await ds.getRepository(PeriodSlot).save({
      tenant_id: tenantId,
      shift_id: shift.id,
      sequence: n,
      kind: PeriodSlotKind.CLASS,
      name: `P${n}`,
      starts_at: `${String(7 + n).padStart(2, '0')}:00`,
      ends_at: `${String(7 + n).padStart(2, '0')}:45`,
    });
    const code = randomUUID().slice(0, 6).toUpperCase();
    const subject = await ds.getRepository(Subject).save({
      tenant_id: tenantId,
      name_en: `Subject ${code}`,
      code,
    });
    const routineSlot = await ds.getRepository(RoutineSlot).save({
      tenant_id: tenantId,
      routine_id: routine.id,
      section_id: sectionId,
      period_slot_id: periodSlot.id,
      weekday,
      subject_id: subject.id,
      recurrence: SlotRecurrence.WEEKLY,
      valid_from: '2026-01-01',
    });
    if (opts.teacherId) {
      await ds.getRepository(RoutineSlotTeacher).save({
        tenant_id: tenantId,
        routine_slot_id: routineSlot.id,
        teacher_id: opts.teacherId,
      });
    }
    slots.push({ routineSlot, subject, periodSlot });
  }

  const substitute = (periodIndex: number, substituteTeacherId: string, onDate = date) =>
    ds.getRepository(RoutineSubstitution).save({
      tenant_id: tenantId,
      routine_slot_id: slots[periodIndex].routineSlot.id,
      date: onDate,
      substitute_teacher_id: substituteTeacherId,
      created_by: opts.createdBy,
    });
  const cancel = (periodIndex: number) =>
    ds.getRepository(RoutineSubstitution).save({
      tenant_id: tenantId,
      routine_slot_id: slots[periodIndex].routineSlot.id,
      date,
      is_cancelled: true,
      created_by: opts.createdBy,
    });

  return { routine, slots, substitute, cancel };
}
