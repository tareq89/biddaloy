import type { EntityManager } from 'typeorm';
import { RoutineSlotTeacher } from '../../../routines/entities/routine-slot-teacher.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { routineSlotsTab } from './routine-slots.tab';
import { teachersTab } from '../people/teachers.tab';

/**
 * The `routine_slot_teachers` tab: which teacher(s) cover a `RoutineSlot`.
 * A plain join row — usually one teacher per slot, but co-taught periods
 * add a second row for the same `routine_slot`.
 *
 * `teacher` is keyed by the teacher's own `employee_id` (that tab's
 * natural key).
 */

export interface RoutineSlotTeacherRow {
  id: string;
  routine_slot_id: string;
  routine_slot_key: string;
  teacher_id: string;
  teacher_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'routine_slot',
    type: 'ref',
    ref: 'routine_slots',
    required: true,
    label: { en: 'Routine slot', bn: 'রুটিন স্লট' },
  },
  {
    key: 'teacher',
    type: 'ref',
    ref: 'teachers',
    required: true,
    label: { en: 'Teacher', bn: 'শিক্ষক' },
  },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new
 * `RoutineSlotTeacher` column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'routine_slot_id', // exported instead as the `routine_slot` ref column
  'teacher_id', // exported instead as the `teacher` ref column
];

export const routineSlotTeachersTab: TabSpec<RoutineSlotTeacher, RoutineSlotTeacherRow> = {
  name: 'routine_slot_teachers',
  entity: RoutineSlotTeacher,
  excluded,
  dependsOn: ['routine_slots', 'teachers'],
  columns,
  naturalKey: ['routine_slot', 'teacher'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<RoutineSlotTeacher[]> {
    return m.find(RoutineSlotTeacher, {
      where: { tenant_id: tenantId },
      relations: [
        'routine_slot',
        'routine_slot.routine',
        'routine_slot.routine.academic_year',
        'routine_slot.section',
        'routine_slot.section.class',
        'routine_slot.section.class.academic_year',
        'routine_slot.period_slot',
        'routine_slot.period_slot.shift',
        'teacher',
      ],
    });
  },

  toRow(entity: RoutineSlotTeacher, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      routine_slot: ctx.keyOf('routine_slots', entity.routine_slot_id),
      teacher: ctx.keyOf('teachers', entity.teacher_id),
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: RoutineSlotTeacherRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'routine_slot_teachers', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const routineSlotKey = values.routine_slot as string;
    const teacherKey = values.teacher as string;

    const routineSlotId = ctx.ref('routine_slots', routineSlotKey);
    if (!routineSlotId) {
      errors.push({
        tab: 'routine_slot_teachers',
        row: rowNo,
        column: 'routine_slot',
        message: `Column "routine_slot": no routine slot named "${routineSlotKey}" was found.`,
        severity: 'error',
        value: routineSlotKey,
      });
    }

    const teacherId = ctx.ref('teachers', teacherKey);
    if (!teacherId) {
      errors.push({
        tab: 'routine_slot_teachers',
        row: rowNo,
        column: 'teacher',
        message: `Column "teacher": no teacher with employee_id "${teacherKey}" was found.`,
        severity: 'error',
        value: teacherKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        routine_slot_id: routineSlotId as string,
        routine_slot_key: routineSlotKey,
        teacher_id: teacherId as string,
        teacher_key: teacherKey,
      },
    };
  },

  keyOf(x: RoutineSlotTeacherRow | RoutineSlotTeacher): string {
    if (x instanceof RoutineSlotTeacher) {
      const slotKey = x.routine_slot ? routineSlotsTab.keyOf(x.routine_slot) : '';
      const teacherKey = x.teacher ? teachersTab.keyOf(x.teacher) : '';
      return `${slotKey}|${teacherKey}`;
    }
    return `${x.routine_slot_key}|${x.teacher_key}`;
  },

  diffFields(row: RoutineSlotTeacherRow, existing: RoutineSlotTeacher): string[] {
    const changed: string[] = [];
    if (row.routine_slot_id !== existing.routine_slot_id) changed.push('routine_slot');
    if (row.teacher_id !== existing.teacher_id) changed.push('teacher');
    return changed;
  },

  async upsert(
    row: RoutineSlotTeacherRow,
    existing: RoutineSlotTeacher | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<RoutineSlotTeacher> {
    const link = existing ?? new RoutineSlotTeacher();
    link.tenant_id = tenantId;
    link.routine_slot_id = row.routine_slot_id;
    link.teacher_id = row.teacher_id;

    return m.save(RoutineSlotTeacher, link);
  },

  async remove(entity: RoutineSlotTeacher, m: EntityManager): Promise<void> {
    await m.remove(RoutineSlotTeacher, entity);
  },
};
