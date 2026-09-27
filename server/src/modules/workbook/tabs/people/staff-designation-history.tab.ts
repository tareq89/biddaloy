import type { EntityManager } from 'typeorm';
import { StaffEmploymentStatus } from '@biddaloy/shared';
import { StaffDesignationHistory } from '../../../staff-hr/entities/staff-designation-history.entity';
import { fromCell, formatDateOnly } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { usersTab } from './users.tab';
import { designationTab } from './designation.tab';

/**
 * The `staff_designation_history` tab (23.5): one entry in a staff
 * member's designation/employment-status history. Two refs — `staff`
 * (users) and `designation` (designations) — so, unlike the single-FK
 * tabs in `staff-child-tab.factory.ts`, this one is hand-written, same call
 * `teacher-assignments.tab.ts` makes for the same reason.
 *
 * `resigned_at` is entity-only (23.1) — never exported, matching the
 * entity's own doc comment.
 */
export interface StaffDesignationHistoryRow {
  id: string;
  staff_user_id: string;
  designation_id: string;
  effective_date: string;
  end_date: string | null;
  status: StaffEmploymentStatus;
  notes: string | null;
  staff_key: string;
  designation_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'staff', type: 'ref', ref: 'users', required: true, label: { en: 'Staff', bn: 'কর্মী' } },
  {
    key: 'designation',
    type: 'ref',
    ref: 'designations',
    required: true,
    label: { en: 'Designation', bn: 'পদবি' },
  },
  {
    key: 'effective_date',
    type: 'date',
    required: true,
    label: { en: 'Effective date', bn: 'কার্যকর তারিখ' },
  },
  { key: 'end_date', type: 'date', label: { en: 'End date', bn: 'শেষ তারিখ' } },
  {
    key: 'status',
    type: 'enum',
    required: true,
    enumValues: Object.values(StaffEmploymentStatus),
    label: { en: 'Status', bn: 'অবস্থা' },
  },
  { key: 'notes', type: 'string', label: { en: 'Notes', bn: 'নোট' } },
];

const excluded: readonly string[] = [
  'user_id', // exported instead as the `staff` ref column
  'designation_id', // exported instead as the `designation` ref column
  'resigned_at', // entity-only (23.1): set internally on RESIGNED, never external input
];

export const staffDesignationHistoryTab: TabSpec<StaffDesignationHistory, StaffDesignationHistoryRow> = {
  name: 'staff_designation_history',
  entity: StaffDesignationHistory,
  excluded,
  dependsOn: ['users', 'designations'],
  columns,
  naturalKey: ['staff', 'designation', 'effective_date'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<StaffDesignationHistory[]> {
    return m.find(StaffDesignationHistory, {
      where: { tenant_id: tenantId },
      relations: ['user', 'designation'],
    });
  },

  toRow(entity: StaffDesignationHistory, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      staff: ctx.keyOf('users', entity.user_id),
      designation: ctx.keyOf('designations', entity.designation_id),
      effective_date: entity.effective_date,
      end_date: entity.end_date,
      status: entity.status,
      notes: entity.notes,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: StaffDesignationHistoryRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'staff_designation_history', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const staffKey = values.staff as string;
    const staffUserId = ctx.ref('users', staffKey);
    if (!staffUserId) {
      errors.push({
        tab: 'staff_designation_history',
        row: rowNo,
        column: 'staff',
        message: `Column "staff": no user with the key "${staffKey}" was found.`,
        severity: 'error',
        value: staffKey,
      });
    }

    const designationKey = values.designation as string;
    const designationId = ctx.ref('designations', designationKey);
    if (!designationId) {
      errors.push({
        tab: 'staff_designation_history',
        row: rowNo,
        column: 'designation',
        message: `Column "designation": no designation with the key "${designationKey}" was found.`,
        severity: 'error',
        value: designationKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        staff_user_id: staffUserId as string,
        designation_id: designationId as string,
        effective_date: values.effective_date as string,
        end_date: (values.end_date as string | null) ?? null,
        status: values.status as StaffEmploymentStatus,
        notes: (values.notes as string | null) ?? null,
        staff_key: staffKey,
        designation_key: designationKey,
      },
    };
  },

  keyOf(x: StaffDesignationHistoryRow | StaffDesignationHistory): string {
    if (x instanceof StaffDesignationHistory) {
      const staffKey = x.user ? usersTab.keyOf(x.user) : '';
      const designationKey = x.designation ? designationTab.keyOf(x.designation) : '';
      return `${staffKey}|${designationKey}|${formatDateOnly(x.effective_date)}`;
    }
    return `${x.staff_key}|${x.designation_key}|${x.effective_date}`;
  },

  diffFields(row: StaffDesignationHistoryRow, existing: StaffDesignationHistory): string[] {
    const changed: string[] = [];
    if (row.end_date !== (existing.end_date ? formatDateOnly(existing.end_date) : null)) {
      changed.push('end_date');
    }
    if (row.status !== existing.status) changed.push('status');
    if (row.notes !== existing.notes) changed.push('notes');
    return changed;
  },

  async upsert(
    row: StaffDesignationHistoryRow,
    existing: StaffDesignationHistory | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<StaffDesignationHistory> {
    const history = existing ?? new StaffDesignationHistory();
    history.tenant_id = tenantId;
    history.user_id = row.staff_user_id;
    history.designation_id = row.designation_id;
    history.effective_date = row.effective_date as unknown as Date;
    history.end_date = row.end_date as unknown as Date | null;
    history.status = row.status;
    history.notes = row.notes;
    return m.save(StaffDesignationHistory, history);
  },

  async remove(entity: StaffDesignationHistory, m: EntityManager): Promise<void> {
    await m.remove(StaffDesignationHistory, entity);
  },
};
