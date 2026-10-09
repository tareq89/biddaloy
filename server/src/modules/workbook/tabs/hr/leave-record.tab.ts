import type { EntityManager } from 'typeorm';
import { LeaveType, LeaveStatus } from '@biddaloy/shared';
import { LeaveRecord } from '../../../leave/entities/leave-record.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `leave_records` tab: one staff member's leave request/decision.
 *
 * `entity: LeaveRecord`, table `leave_records`
 * (`server/src/modules/leave/entities/leave-record.entity.ts`, migration
 * `1789800014000-StaffAttendanceLeave.ts`). No unique DB constraint exists
 * on this table beyond `id`, unlike every other tab so far — the natural
 * key here is a judgment call: `(staff_profile, start_date, end_date)`,
 * which is unique in practice (a staff member does not file two leave
 * requests spanning the exact same dates) and lets export/import match a
 * row across a restore without ever inventing a new uuid for an
 * unmodified request.
 */
export interface LeaveRecordRow {
  id: string;
  staff_profile_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days: number;
  status: LeaveStatus;
  reason: string | null;
  approved_by: string | null;
  decided_at: string | null;
  staff_profile_key: string;
  approved_by_key: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'staff_profile',
    type: 'ref',
    ref: 'staff_profiles',
    required: true,
    label: { en: 'Staff', bn: 'কর্মচারী' },
  },
  {
    key: 'leave_type',
    type: 'enum',
    enumValues: Object.values(LeaveType),
    required: true,
    label: { en: 'Leave type', bn: 'ছুটির ধরন' },
  },
  {
    key: 'start_date',
    type: 'date',
    required: true,
    label: { en: 'Start date', bn: 'শুরুর তারিখ' },
  },
  { key: 'end_date', type: 'date', required: true, label: { en: 'End date', bn: 'শেষ তারিখ' } },
  { key: 'days', type: 'int', required: true, label: { en: 'Days', bn: 'দিন' } },
  {
    // Not `required`; an empty cell defaults to the entity's own default
    // (`PENDING`).
    key: 'status',
    type: 'enum',
    enumValues: Object.values(LeaveStatus),
    label: { en: 'Status', bn: 'অবস্থা' },
  },
  { key: 'reason', type: 'string', label: { en: 'Reason', bn: 'কারণ' } },
  {
    key: 'approved_by',
    type: 'ref',
    ref: 'users',
    label: { en: 'Approved by', bn: 'অনুমোদনকারী' },
  },
  { key: 'decided_at', type: 'datetime', label: { en: 'Decided at', bn: 'সিদ্ধান্তের সময়' } },
];

const MAX_LENGTHS: Record<string, number> = {
  reason: 255,
};

const excluded: readonly string[] = [
  'staff_profile_id', // exported instead as the `staff_profile` ref column, keyed by the referenced tab's natural key
  // `approved_by` is not excluded: the entity column and the `ref` column
  // share the same key (unlike `student_id` → `student`), so it appears
  // only in `columns`, and the completeness gate treats that as covered.
  'tenant_id', // implicit: every row is scoped to the workbook's own tenant
];

export const leaveRecordTab: TabSpec<LeaveRecord, LeaveRecordRow> = {
  name: 'leave_records',
  entity: LeaveRecord,
  excluded,
  dependsOn: ['staff_profiles', 'users'],
  columns,
  naturalKey: ['staff_profile', 'start_date', 'end_date'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<LeaveRecord[]> {
    // `staff_profile` is needed eagerly: `keyOf` reads its natural-key field
    // directly off the relation. `approver` is resolved via `ctx.keyOf` from
    // the stored id, so no eager relation is needed for it.
    return m.find(LeaveRecord, {
      where: { tenant_id: tenantId },
      relations: ['staff_profile'],
    });
  },

  toRow(entity: LeaveRecord, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      staff_profile: ctx.keyOf('staff_profiles', entity.staff_profile_id),
      leave_type: entity.leave_type,
      start_date: entity.start_date,
      end_date: entity.end_date,
      days: entity.days,
      status: entity.status,
      reason: entity.reason,
      approved_by: entity.approved_by ? ctx.keyOf('users', entity.approved_by) : null,
      decided_at: entity.decided_at,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: LeaveRecordRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'leave_records', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'leave_records',
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

    const staffProfileKey = values.staff_profile as string;
    const staffProfileId = ctx.ref('staff_profiles', staffProfileKey);
    if (!staffProfileId) {
      errors.push({
        tab: 'leave_records',
        row: rowNo,
        column: 'staff_profile',
        message: `Column "staff_profile": no staff with the key "${staffProfileKey}" was found.`,
        severity: 'error',
        value: staffProfileKey,
      });
    }

    // `approved_by` is optional: an empty cell means "not yet decided",
    // not an error.
    const approvedByKey = (values.approved_by as string | null) ?? '';
    let approvedById: string | null = null;
    if (approvedByKey) {
      const resolved = ctx.ref('users', approvedByKey);
      if (!resolved) {
        errors.push({
          tab: 'leave_records',
          row: rowNo,
          column: 'approved_by',
          message: `Column "approved_by": no user with the key "${approvedByKey}" was found.`,
          severity: 'error',
          value: approvedByKey,
        });
      } else {
        approvedById = resolved;
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        staff_profile_id: staffProfileId as string,
        leave_type: values.leave_type as LeaveType,
        start_date: values.start_date as string,
        end_date: values.end_date as string,
        days: values.days as number,
        status: (values.status as LeaveStatus | null) ?? LeaveStatus.PENDING,
        reason: (values.reason as string | null) ?? null,
        approved_by: approvedById,
        decided_at: (values.decided_at as string | null) ?? null,
        staff_profile_key: staffProfileKey,
        approved_by_key: approvedByKey ? approvedByKey : null,
      },
    };
  },

  keyOf(x: LeaveRecordRow | LeaveRecord): string {
    const staffProfileKey =
      x instanceof LeaveRecord ? (x.staff_profile?.employee_id ?? '') : x.staff_profile_key;
    return `${staffProfileKey}|${x.start_date}|${x.end_date}`;
  },

  diffFields(row: LeaveRecordRow, existing: LeaveRecord): string[] {
    const changed: string[] = [];
    if (row.staff_profile_id !== existing.staff_profile_id) changed.push('staff_profile');
    if (row.leave_type !== existing.leave_type) changed.push('leave_type');
    if (row.start_date !== existing.start_date) changed.push('start_date');
    if (row.end_date !== existing.end_date) changed.push('end_date');
    if (row.days !== existing.days) changed.push('days');
    if (row.status !== existing.status) changed.push('status');
    if (row.reason !== existing.reason) changed.push('reason');
    if (row.approved_by !== existing.approved_by) changed.push('approved_by');
    const rowDecidedAt = row.decided_at;
    const existingDecidedAt = existing.decided_at ? existing.decided_at.toISOString() : null;
    if (rowDecidedAt !== existingDecidedAt) changed.push('decided_at');
    return changed;
  },

  async upsert(
    row: LeaveRecordRow,
    existing: LeaveRecord | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<LeaveRecord> {
    const record =
      existing ??
      (await m.findOne(LeaveRecord, {
        where: {
          tenant_id: tenantId,
          staff_profile_id: row.staff_profile_id,
          start_date: row.start_date,
          end_date: row.end_date,
        },
      })) ??
      new LeaveRecord();

    record.tenant_id = tenantId;
    record.staff_profile_id = row.staff_profile_id;
    record.leave_type = row.leave_type;
    record.start_date = row.start_date;
    record.end_date = row.end_date;
    record.days = row.days;
    record.status = row.status;
    record.reason = row.reason;
    record.approved_by = row.approved_by;
    record.decided_at = row.decided_at ? new Date(row.decided_at) : null;

    return m.save(LeaveRecord, record);
  },

  async remove(entity: LeaveRecord, m: EntityManager): Promise<void> {
    await m.remove(LeaveRecord, entity);
  },
};
