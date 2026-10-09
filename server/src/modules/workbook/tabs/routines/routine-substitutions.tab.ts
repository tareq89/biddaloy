import type { EntityManager } from 'typeorm';
import { RoutineSubstitution } from '../../../routines/entities/routine-substitution.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { routineSlotsTab } from './routine-slots.tab';

/**
 * The `routine_substitutions` tab: a dated override of a `RoutineSlot` —
 * a substitute teacher covering a period, or the period cancelled
 * outright, without touching the slot's own effective-dated row (D12).
 *
 * `substitute_teacher` is nullable: a cancellation (`is_cancelled = true`)
 * has no substitute. `created_by` is a `ref` to `users`, keyed by email
 * (or phone), matching `users.tab.ts`'s own natural key.
 */

export interface RoutineSubstitutionRow {
  id: string;
  routine_slot_id: string;
  routine_slot_key: string;
  date: string;
  substitute_teacher_id: string | null;
  substitute_teacher_key: string | null;
  is_cancelled: boolean;
  reason: string | null;
  created_by: string;
  created_by_key: string;
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
  { key: 'date', type: 'date', required: true, label: { en: 'Date', bn: 'তারিখ' } },
  {
    key: 'substitute_teacher',
    type: 'ref',
    ref: 'teachers',
    label: { en: 'Substitute teacher', bn: 'বিকল্প শিক্ষক' },
  },
  { key: 'is_cancelled', type: 'bool', required: true, label: { en: 'Cancelled', bn: 'বাতিল' } },
  { key: 'reason', type: 'string', label: { en: 'Reason', bn: 'কারণ' } },
  {
    key: 'created_by',
    type: 'ref',
    ref: 'users',
    required: true,
    label: { en: 'Created by', bn: 'তৈরি করেছেন' },
  },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new
 * `RoutineSubstitution` column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'routine_slot_id', // exported instead as the `routine_slot` ref column
  'substitute_teacher_id', // exported instead as the `substitute_teacher` ref column
];

const MAX_LENGTHS: Record<string, number> = { reason: 280 };

export const routineSubstitutionsTab: TabSpec<RoutineSubstitution, RoutineSubstitutionRow> = {
  name: 'routine_substitutions',
  entity: RoutineSubstitution,
  excluded,
  dependsOn: ['routine_slots', 'teachers', 'users'],
  columns,
  naturalKey: ['routine_slot', 'date'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<RoutineSubstitution[]> {
    return m.find(RoutineSubstitution, {
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
        'substitute_teacher',
        'created_by_user',
      ],
    });
  },

  toRow(entity: RoutineSubstitution, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      routine_slot: ctx.keyOf('routine_slots', entity.routine_slot_id),
      date: entity.date,
      substitute_teacher: entity.substitute_teacher_id
        ? ctx.keyOf('teachers', entity.substitute_teacher_id)
        : null,
      is_cancelled: entity.is_cancelled,
      reason: entity.reason,
      created_by: ctx.keyOf('users', entity.created_by),
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: RoutineSubstitutionRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'routine_substitutions', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'routine_substitutions',
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

    const routineSlotKey = values.routine_slot as string;
    const routineSlotId = ctx.ref('routine_slots', routineSlotKey);
    if (!routineSlotId) {
      errors.push({
        tab: 'routine_substitutions',
        row: rowNo,
        column: 'routine_slot',
        message: `Column "routine_slot": no routine slot named "${routineSlotKey}" was found.`,
        severity: 'error',
        value: routineSlotKey,
      });
    }

    const substituteKey = (values.substitute_teacher as string | null) ?? null;
    let substituteTeacherId: string | null = null;
    if (substituteKey) {
      substituteTeacherId = ctx.ref('teachers', substituteKey) ?? null;
      if (!substituteTeacherId) {
        errors.push({
          tab: 'routine_substitutions',
          row: rowNo,
          column: 'substitute_teacher',
          message: `Column "substitute_teacher": no teacher with employee_id "${substituteKey}" was found.`,
          severity: 'error',
          value: substituteKey,
        });
      }
    }

    const createdByKey = values.created_by as string;
    const createdById = ctx.ref('users', createdByKey);
    if (!createdById) {
      errors.push({
        tab: 'routine_substitutions',
        row: rowNo,
        column: 'created_by',
        message: `Column "created_by": no user "${createdByKey}" was found.`,
        severity: 'error',
        value: createdByKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        routine_slot_id: routineSlotId as string,
        routine_slot_key: routineSlotKey,
        date: values.date as string,
        substitute_teacher_id: substituteTeacherId,
        substitute_teacher_key: substituteKey,
        is_cancelled: values.is_cancelled as boolean,
        reason: (values.reason as string | null) ?? null,
        created_by: createdById as string,
        created_by_key: createdByKey,
      },
    };
  },

  keyOf(x: RoutineSubstitutionRow | RoutineSubstitution): string {
    if (x instanceof RoutineSubstitution) {
      const slotKey = x.routine_slot ? routineSlotsTab.keyOf(x.routine_slot) : '';
      return `${slotKey}|${x.date}`;
    }
    return `${x.routine_slot_key}|${x.date}`;
  },

  diffFields(row: RoutineSubstitutionRow, existing: RoutineSubstitution): string[] {
    const changed: string[] = [];
    if (row.routine_slot_id !== existing.routine_slot_id) changed.push('routine_slot');
    if (row.date !== existing.date) changed.push('date');
    if (row.substitute_teacher_id !== existing.substitute_teacher_id)
      changed.push('substitute_teacher');
    if (row.is_cancelled !== existing.is_cancelled) changed.push('is_cancelled');
    if (row.reason !== existing.reason) changed.push('reason');
    if (row.created_by !== existing.created_by) changed.push('created_by');
    return changed;
  },

  async upsert(
    row: RoutineSubstitutionRow,
    existing: RoutineSubstitution | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<RoutineSubstitution> {
    const sub = existing ?? new RoutineSubstitution();
    sub.tenant_id = tenantId;
    sub.routine_slot_id = row.routine_slot_id;
    sub.date = row.date;
    sub.substitute_teacher_id = row.substitute_teacher_id;
    sub.is_cancelled = row.is_cancelled;
    sub.reason = row.reason;
    sub.created_by = row.created_by;

    return m.save(RoutineSubstitution, sub);
  },

  async remove(entity: RoutineSubstitution, m: EntityManager): Promise<void> {
    await m.remove(RoutineSubstitution, entity);
  },
};
