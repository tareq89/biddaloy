import type { EntityManager } from 'typeorm';
import { StaffAttendanceSession } from '../../../staff-attendance/entities/staff-attendance-session.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `staff_attendance_sessions` tab: one tenant's staff attendance day.
 *
 * `entity: StaffAttendanceSession`, table `staff_attendance_sessions`
 * (`server/src/modules/staff-attendance/entities/staff-attendance-session.entity.ts`,
 * migration `1789800014000-StaffAttendanceLeave.ts`). `date` is unique per
 * tenant (`UQ_staff_attendance_sessions_tenant_date`) and is the natural key.
 *
 * `version` is excluded: it's a bookkeeping counter bumped by app code on
 * every correction, not user-editable workbook data.
 */
export interface StaffAttendanceSessionRow {
  id: string;
  date: string; // 'YYYY-MM-DD'
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'date',
    type: 'date',
    required: true,
    label: { en: 'Date', bn: 'তারিখ' },
  },
];

const excluded: readonly string[] = [
  'version', // bumped by app code on every correction, not user-editable workbook data
  'tenant_id', // implicit: every row is scoped to the workbook's own tenant
];

export const staffAttendanceSessionTab: TabSpec<StaffAttendanceSession, StaffAttendanceSessionRow> =
  {
    name: 'staff_attendance_sessions',
    entity: StaffAttendanceSession,
    excluded,
    dependsOn: [],
    columns,
    naturalKey: ['date'],
    deleteByAbsence: true,

    load(tenantId: string, m: EntityManager): Promise<StaffAttendanceSession[]> {
      return m.find(StaffAttendanceSession, { where: { tenant_id: tenantId } });
    },

    toRow(entity: StaffAttendanceSession, _ctx: ExportContext): Record<string, unknown> {
      return {
        id: entity.id,
        date: entity.date,
      };
    },

    fromRow(
      cells: Record<string, string>,
      rowNo: number,
      _ctx: ImportContext,
    ): { row: StaffAttendanceSessionRow } | { errors: RowError[] } {
      const errors: RowError[] = [];
      const values: Record<string, unknown> = {};

      for (const column of columns) {
        const raw = cells[column.key] ?? '';
        const result = fromCell(column, raw, 'staff_attendance_sessions', rowNo);
        if ('error' in result) {
          errors.push(result.error);
          continue;
        }
        values[column.key] = result.value;
      }

      if (errors.length > 0) return { errors };

      return {
        row: {
          id: values.id as string,
          date: values.date as string,
        },
      };
    },

    keyOf(x: StaffAttendanceSessionRow | StaffAttendanceSession): string {
      return x.date;
    },

    diffFields(row: StaffAttendanceSessionRow, existing: StaffAttendanceSession): string[] {
      const changed: string[] = [];
      if (row.date !== existing.date) changed.push('date');
      return changed;
    },

    async upsert(
      row: StaffAttendanceSessionRow,
      existing: StaffAttendanceSession | null,
      tenantId: string,
      m: EntityManager,
    ): Promise<StaffAttendanceSession> {
      const session =
        existing ??
        (await m.findOne(StaffAttendanceSession, {
          where: { tenant_id: tenantId, date: row.date },
        })) ??
        new StaffAttendanceSession();

      session.tenant_id = tenantId;
      session.date = row.date;

      return m.save(StaffAttendanceSession, session);
    },

    async remove(entity: StaffAttendanceSession, m: EntityManager): Promise<void> {
      await m.remove(StaffAttendanceSession, entity);
    },
  };
