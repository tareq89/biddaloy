import type { EntityManager } from 'typeorm';
import { SeatAllocation } from '../../../seat-plans/entities/seat-allocation.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { seatPlansTab } from './seat-plans.tab';
import { examSchedulesTab } from './exam-schedules.tab';
import { studentsTab } from '../people/students.tab';

/**
 * The `seat_allocations` tab: one student's seat for one subject sitting
 * within one seat plan (25.1.1's `SeatAllocation`).
 *
 * `(seat_plan, exam_schedule, student)` is this tab's `naturalKey`, matching
 * the DB's own unique index on `(tenant_id, seat_plan_id, exam_schedule_id,
 * student_id)` exactly. `room`/`seat_number` are not part of the key — they
 * are what a re-import is allowed to change (the manual-edit/reshuffle case
 * this ticket's own integration test exercises).
 *
 * `SeatAllocation` has no soft-delete column (`remove` hard-deletes, same as
 * `routine-slots.tab.ts`).
 */

export interface SeatAllocationRow {
  id: string;
  seat_plan_id: string;
  seat_plan_key: string;
  exam_schedule_id: string;
  exam_schedule_key: string;
  student_id: string;
  student_key: string;
  room_id: string;
  room_key: string;
  seat_number: string;
  invigilator_user_id: string | null;
  invigilator_user_key: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'seat_plan',
    type: 'ref',
    ref: 'seat_plans',
    required: true,
    label: { en: 'Seat plan', bn: 'সিট পরিকল্পনা' },
  },
  {
    key: 'exam_schedule',
    type: 'ref',
    ref: 'exam_schedules',
    required: true,
    label: { en: 'Exam schedule', bn: 'পরীক্ষার সময়সূচি' },
  },
  {
    key: 'student',
    type: 'ref',
    ref: 'students',
    required: true,
    label: { en: 'Student', bn: 'শিক্ষার্থী' },
  },
  { key: 'room', type: 'ref', ref: 'rooms', required: true, label: { en: 'Room', bn: 'কক্ষ' } },
  {
    key: 'seat_number',
    type: 'string',
    required: true,
    label: { en: 'Seat number', bn: 'সিট নম্বর' },
  },
  {
    key: 'invigilator',
    type: 'ref',
    ref: 'users',
    label: { en: 'Invigilator', bn: 'পরিদর্শক' },
  },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `SeatAllocation`
 * column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'seat_plan_id', // exported instead as the `seat_plan` ref column
  'exam_schedule_id', // exported instead as the `exam_schedule` ref column
  'student_id', // exported instead as the `student` ref column
  'room_id', // exported instead as the `room` ref column
  'invigilator_user_id', // exported instead as the `invigilator` ref column
];

const MAX_LENGTHS: Record<string, number> = {
  seat_number: 20,
};

export const seatAllocationsTab: TabSpec<SeatAllocation, SeatAllocationRow> = {
  name: 'seat_allocations',
  entity: SeatAllocation,
  excluded,
  dependsOn: ['seat_plans', 'exam_schedules', 'students', 'rooms', 'users'],
  columns,
  naturalKey: ['seat_plan', 'exam_schedule', 'student'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<SeatAllocation[]> {
    return m.find(SeatAllocation, {
      where: { tenant_id: tenantId },
      relations: [
        'seat_plan',
        'exam_schedule',
        'exam_schedule.exam',
        'exam_schedule.exam.academic_year',
        'exam_schedule.exam.class',
        'exam_schedule.exam.class.academic_year',
        'exam_schedule.subject',
        'student',
        'room',
      ],
    });
  },

  toRow(entity: SeatAllocation, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      seat_plan: ctx.keyOf('seat_plans', entity.seat_plan_id),
      exam_schedule: ctx.keyOf('exam_schedules', entity.exam_schedule_id),
      student: ctx.keyOf('students', entity.student_id),
      room: ctx.keyOf('rooms', entity.room_id),
      seat_number: entity.seat_number,
      invigilator: entity.invigilator_user_id
        ? ctx.keyOf('users', entity.invigilator_user_id)
        : null,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: SeatAllocationRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'seat_allocations', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'seat_allocations',
          row: rowNo,
          column: column.key,
          message: `Column "${column.key}": is longer than the ${limit} characters allowed.`,
          severity: 'error',
          value: raw,
        });
        continue;
      }

      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const seatPlanKey = values.seat_plan as string;
    const seatPlanId = ctx.ref('seat_plans', seatPlanKey);
    if (!seatPlanId) {
      errors.push({
        tab: 'seat_allocations',
        row: rowNo,
        column: 'seat_plan',
        message: `Column "seat_plan": no seat plan "${seatPlanKey}" was found.`,
        severity: 'error',
        value: seatPlanKey,
      });
    }

    const examScheduleKey = values.exam_schedule as string;
    const examScheduleId = ctx.ref('exam_schedules', examScheduleKey);
    if (!examScheduleId) {
      errors.push({
        tab: 'seat_allocations',
        row: rowNo,
        column: 'exam_schedule',
        message: `Column "exam_schedule": no exam schedule "${examScheduleKey}" was found.`,
        severity: 'error',
        value: examScheduleKey,
      });
    }

    const studentKey = values.student as string;
    const studentId = ctx.ref('students', studentKey);
    if (!studentId) {
      errors.push({
        tab: 'seat_allocations',
        row: rowNo,
        column: 'student',
        message: `Column "student": no student "${studentKey}" was found.`,
        severity: 'error',
        value: studentKey,
      });
    }

    const roomKey = values.room as string;
    const roomId = ctx.ref('rooms', roomKey);
    if (!roomId) {
      errors.push({
        tab: 'seat_allocations',
        row: rowNo,
        column: 'room',
        message: `Column "room": no room "${roomKey}" was found.`,
        severity: 'error',
        value: roomKey,
      });
    }

    let invigilatorUserId: string | null = null;
    const invigilatorKey = (values.invigilator as string | null) ?? null;
    if (invigilatorKey) {
      invigilatorUserId = ctx.ref('users', invigilatorKey) ?? null;
      if (!invigilatorUserId) {
        errors.push({
          tab: 'seat_allocations',
          row: rowNo,
          column: 'invigilator',
          message: `Column "invigilator": no user "${invigilatorKey}" was found.`,
          severity: 'error',
          value: invigilatorKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        seat_plan_id: seatPlanId as string,
        seat_plan_key: seatPlanKey,
        exam_schedule_id: examScheduleId as string,
        exam_schedule_key: examScheduleKey,
        student_id: studentId as string,
        student_key: studentKey,
        room_id: roomId as string,
        room_key: roomKey,
        seat_number: values.seat_number as string,
        invigilator_user_id: invigilatorUserId,
        invigilator_user_key: invigilatorKey,
      },
    };
  },

  keyOf(x: SeatAllocationRow | SeatAllocation): string {
    if (x instanceof SeatAllocation) {
      const seatPlanKey = x.seat_plan ? seatPlansTab.keyOf(x.seat_plan) : '';
      const examScheduleKey = x.exam_schedule ? examSchedulesTab.keyOf(x.exam_schedule) : '';
      const studentKey = x.student ? studentsTab.keyOf(x.student) : '';
      return `${seatPlanKey}|${examScheduleKey}|${studentKey}`;
    }
    return `${x.seat_plan_key}|${x.exam_schedule_key}|${x.student_key}`;
  },

  diffFields(row: SeatAllocationRow, existing: SeatAllocation): string[] {
    const changed: string[] = [];
    if (row.seat_plan_id !== existing.seat_plan_id) changed.push('seat_plan');
    if (row.exam_schedule_id !== existing.exam_schedule_id) changed.push('exam_schedule');
    if (row.student_id !== existing.student_id) changed.push('student');
    if (row.room_id !== existing.room_id) changed.push('room');
    if (row.seat_number !== existing.seat_number) changed.push('seat_number');
    if ((row.invigilator_user_id ?? null) !== (existing.invigilator_user_id ?? null)) {
      changed.push('invigilator');
    }
    return changed;
  },

  async upsert(
    row: SeatAllocationRow,
    existing: SeatAllocation | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<SeatAllocation> {
    const allocation = existing ?? new SeatAllocation();
    allocation.tenant_id = tenantId;
    allocation.seat_plan_id = row.seat_plan_id;
    allocation.exam_schedule_id = row.exam_schedule_id;
    allocation.student_id = row.student_id;
    allocation.room_id = row.room_id;
    allocation.seat_number = row.seat_number;
    allocation.invigilator_user_id = row.invigilator_user_id;

    return m.save(SeatAllocation, allocation);
  },

  async remove(entity: SeatAllocation, m: EntityManager): Promise<void> {
    await m.remove(SeatAllocation, entity);
  },
};
