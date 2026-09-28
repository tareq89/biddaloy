import type { EntityManager } from 'typeorm';
import { AttendanceStatus, AttendanceSource } from '@biddaloy/shared';
import { StaffAttendanceRecord } from '../../../staff-attendance/entities/staff-attendance-record.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `staff_attendance_records` tab: one staff member's mark within one
 * `staff_attendance_sessions` day.
 *
 * `entity: StaffAttendanceRecord`, table `staff_attendance_records`
 * (`server/src/modules/staff-attendance/entities/staff-attendance-record.entity.ts`,
 * migration `1789800014000-StaffAttendanceLeave.ts`). Natural key is the
 * composite `(session, staff_profile)`, matching the entity's own unique
 * index `UQ_staff_attendance_records_session_staff`.
 */
export interface StaffAttendanceRecordRow {
  id: string;
  session_id: string;
  staff_profile_id: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  check_in_at: string | null; // ISO
  check_out_at: string | null; // ISO
  session_key: string;
  staff_profile_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'session',
    type: 'ref',
    ref: 'staff_attendance_sessions',
    required: true,
    label: { en: 'Session', bn: 'সেশন' },
  },
  {
    key: 'staff_profile',
    type: 'ref',
    ref: 'staff_profiles',
    required: true,
    label: { en: 'Staff', bn: 'কর্মচারী' },
  },
  {
    key: 'status',
    type: 'enum',
    enumValues: Object.values(AttendanceStatus),
    required: true,
    label: { en: 'Status', bn: 'অবস্থা' },
  },
  {
    // Not `required`; an empty cell defaults to the entity's own default
    // (`TEACHER`).
    key: 'source',
    type: 'enum',
    enumValues: Object.values(AttendanceSource),
    label: { en: 'Source', bn: 'উৎস' },
  },
  {
    key: 'check_in_at',
    type: 'datetime',
    label: { en: 'Check-in at', bn: 'প্রবেশের সময়' },
  },
  {
    key: 'check_out_at',
    type: 'datetime',
    label: { en: 'Check-out at', bn: 'প্রস্থানের সময়' },
  },
];

const excluded: readonly string[] = [
  'session_id', // exported instead as the `session` ref column, keyed by the referenced tab's natural key
  'staff_profile_id', // exported instead as the `staff_profile` ref column, keyed by the referenced tab's natural key
  'tenant_id', // implicit: every row is scoped to the workbook's own tenant
];

export const staffAttendanceRecordTab: TabSpec<StaffAttendanceRecord, StaffAttendanceRecordRow> = {
  name: 'staff_attendance_records',
  entity: StaffAttendanceRecord,
  excluded,
  dependsOn: ['staff_attendance_sessions', 'staff_profiles'],
  columns,
  naturalKey: ['session', 'staff_profile'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<StaffAttendanceRecord[]> {
    // `session`/`staff_profile` are needed eagerly: `keyOf` reads their
    // natural-key fields directly off the relation.
    return m.find(StaffAttendanceRecord, {
      where: { tenant_id: tenantId },
      relations: ['session', 'staff_profile'],
    });
  },

  toRow(entity: StaffAttendanceRecord, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      session: ctx.keyOf('staff_attendance_sessions', entity.session_id),
      staff_profile: ctx.keyOf('staff_profiles', entity.staff_profile_id),
      status: entity.status,
      source: entity.source,
      check_in_at: entity.check_in_at,
      check_out_at: entity.check_out_at,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: StaffAttendanceRecordRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'staff_attendance_records', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const sessionKey = values.session as string;
    const sessionId = ctx.ref('staff_attendance_sessions', sessionKey);
    if (!sessionId) {
      errors.push({
        tab: 'staff_attendance_records',
        row: rowNo,
        column: 'session',
        message: `Column "session": no session dated "${sessionKey}" was found.`,
        severity: 'error',
        value: sessionKey,
      });
    }

    const staffProfileKey = values.staff_profile as string;
    const staffProfileId = ctx.ref('staff_profiles', staffProfileKey);
    if (!staffProfileId) {
      errors.push({
        tab: 'staff_attendance_records',
        row: rowNo,
        column: 'staff_profile',
        message: `Column "staff_profile": no staff with the key "${staffProfileKey}" was found.`,
        severity: 'error',
        value: staffProfileKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        session_id: sessionId as string,
        staff_profile_id: staffProfileId as string,
        status: values.status as AttendanceStatus,
        source: (values.source as AttendanceSource | null) ?? AttendanceSource.TEACHER,
        check_in_at: (values.check_in_at as string | null) ?? null,
        check_out_at: (values.check_out_at as string | null) ?? null,
        session_key: sessionKey,
        staff_profile_key: staffProfileKey,
      },
    };
  },

  keyOf(x: StaffAttendanceRecordRow | StaffAttendanceRecord): string {
    const sessionKey = x instanceof StaffAttendanceRecord ? (x.session?.date ?? '') : x.session_key;
    const staffProfileKey =
      x instanceof StaffAttendanceRecord
        ? (x.staff_profile?.employee_id ?? '')
        : x.staff_profile_key;
    return `${sessionKey}|${staffProfileKey}`;
  },

  diffFields(row: StaffAttendanceRecordRow, existing: StaffAttendanceRecord): string[] {
    const changed: string[] = [];
    if (row.session_id !== existing.session_id) changed.push('session');
    if (row.staff_profile_id !== existing.staff_profile_id) changed.push('staff_profile');
    if (row.status !== existing.status) changed.push('status');
    if (row.source !== existing.source) changed.push('source');
    const rowCheckIn = row.check_in_at;
    const existingCheckIn = existing.check_in_at ? existing.check_in_at.toISOString() : null;
    if (rowCheckIn !== existingCheckIn) changed.push('check_in_at');
    const rowCheckOut = row.check_out_at;
    const existingCheckOut = existing.check_out_at ? existing.check_out_at.toISOString() : null;
    if (rowCheckOut !== existingCheckOut) changed.push('check_out_at');
    return changed;
  },

  async upsert(
    row: StaffAttendanceRecordRow,
    existing: StaffAttendanceRecord | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<StaffAttendanceRecord> {
    const record =
      existing ??
      (await m.findOne(StaffAttendanceRecord, {
        where: { session_id: row.session_id, staff_profile_id: row.staff_profile_id },
      })) ??
      new StaffAttendanceRecord();

    record.tenant_id = tenantId;
    record.session_id = row.session_id;
    record.staff_profile_id = row.staff_profile_id;
    record.status = row.status;
    record.source = row.source;
    record.check_in_at = row.check_in_at ? new Date(row.check_in_at) : null;
    record.check_out_at = row.check_out_at ? new Date(row.check_out_at) : null;

    return m.save(StaffAttendanceRecord, record);
  },

  async remove(entity: StaffAttendanceRecord, m: EntityManager): Promise<void> {
    await m.remove(StaffAttendanceRecord, entity);
  },
};
