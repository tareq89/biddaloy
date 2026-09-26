import type { EntityManager } from 'typeorm';
import { SeatPlanSchedule } from '../../../seat-plans/entities/seat-plan-schedule.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { examSchedulesTab } from './exam-schedules.tab';

/**
 * The `seat_plan_schedules` tab: the join row saying one exam schedule
 * (subject sitting) belongs to one seat plan (25.1.1's `SeatPlanSchedule`).
 *
 * `exam_schedule` alone is this tab's `naturalKey` — it mirrors the DB's own
 * unique index on `(tenant_id, exam_schedule_id)` (partial on
 * `deleted_at IS NULL`): a subject sitting can only ever be in one plan at a
 * time, so the schedule alone already identifies the row without needing
 * the plan too.
 */

export interface SeatPlanScheduleRow {
  id: string;
  seat_plan_id: string;
  seat_plan_key: string;
  exam_schedule_id: string;
  exam_schedule_key: string;
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
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `SeatPlanSchedule`
 * column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'seat_plan_id', // exported instead as the `seat_plan` ref column
  'exam_schedule_id', // exported instead as the `exam_schedule` ref column
];

export const seatPlanSchedulesTab: TabSpec<SeatPlanSchedule, SeatPlanScheduleRow> = {
  name: 'seat_plan_schedules',
  entity: SeatPlanSchedule,
  excluded,
  dependsOn: ['seat_plans', 'exam_schedules'],
  columns,
  naturalKey: ['exam_schedule'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<SeatPlanSchedule[]> {
    return m.find(SeatPlanSchedule, {
      where: { tenant_id: tenantId },
      relations: [
        'seat_plan',
        'exam_schedule',
        'exam_schedule.exam',
        'exam_schedule.exam.academic_year',
        'exam_schedule.exam.class',
        'exam_schedule.exam.class.academic_year',
        'exam_schedule.subject',
      ],
    });
  },

  toRow(entity: SeatPlanSchedule, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      seat_plan: ctx.keyOf('seat_plans', entity.seat_plan_id),
      exam_schedule: ctx.keyOf('exam_schedules', entity.exam_schedule_id),
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: SeatPlanScheduleRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'seat_plan_schedules', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const seatPlanKey = values.seat_plan as string;
    const seatPlanId = ctx.ref('seat_plans', seatPlanKey);
    if (!seatPlanId) {
      errors.push({
        tab: 'seat_plan_schedules',
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
        tab: 'seat_plan_schedules',
        row: rowNo,
        column: 'exam_schedule',
        message: `Column "exam_schedule": no exam schedule "${examScheduleKey}" was found.`,
        severity: 'error',
        value: examScheduleKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        seat_plan_id: seatPlanId as string,
        seat_plan_key: seatPlanKey,
        exam_schedule_id: examScheduleId as string,
        exam_schedule_key: examScheduleKey,
      },
    };
  },

  keyOf(x: SeatPlanScheduleRow | SeatPlanSchedule): string {
    if (x instanceof SeatPlanSchedule) {
      return x.exam_schedule ? examSchedulesTab.keyOf(x.exam_schedule) : '';
    }
    return x.exam_schedule_key;
  },

  diffFields(row: SeatPlanScheduleRow, existing: SeatPlanSchedule): string[] {
    const changed: string[] = [];
    if (row.seat_plan_id !== existing.seat_plan_id) changed.push('seat_plan');
    if (row.exam_schedule_id !== existing.exam_schedule_id) changed.push('exam_schedule');
    return changed;
  },

  async upsert(
    row: SeatPlanScheduleRow,
    existing: SeatPlanSchedule | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<SeatPlanSchedule> {
    const schedule = existing ?? new SeatPlanSchedule();
    schedule.tenant_id = tenantId;
    schedule.seat_plan_id = row.seat_plan_id;
    schedule.exam_schedule_id = row.exam_schedule_id;

    return m.save(SeatPlanSchedule, schedule);
  },

  async remove(entity: SeatPlanSchedule, m: EntityManager): Promise<void> {
    await m.softRemove(SeatPlanSchedule, entity);
  },
};
