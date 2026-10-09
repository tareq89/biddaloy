import type { EntityManager } from 'typeorm';
import { LeaveType } from '@biddaloy/shared';
import { LeavePolicy } from '../../../leave/entities/leave-policy.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `leave_policies` tab: a tenant's annual quota for one `LeaveType`.
 *
 * `entity: LeavePolicy`, table `leave_policies`
 * (`server/src/modules/leave/entities/leave-policy.entity.ts`, migration
 * `1789800014000-StaffAttendanceLeave.ts`). `leave_type` is unique per
 * tenant (`UQ_leave_policies_tenant_type` — really
 * `IDX_leave_policies_tenant_leave_type` per the entity's `@Index`) and is
 * the natural key: there is at most one row per `LeaveType` per tenant.
 */
export interface LeavePolicyRow {
  id: string;
  leave_type: LeaveType;
  annual_quota_days: number;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'leave_type',
    type: 'enum',
    enumValues: Object.values(LeaveType),
    required: true,
    label: { en: 'Leave type', bn: 'ছুটির ধরন' },
  },
  {
    key: 'annual_quota_days',
    type: 'int',
    required: true,
    label: { en: 'Annual quota (days)', bn: 'বার্ষিক কোটা (দিন)' },
  },
];

const excluded: readonly string[] = [
  'tenant_id', // implicit: every row is scoped to the workbook's own tenant
];

export const leavePolicyTab: TabSpec<LeavePolicy, LeavePolicyRow> = {
  name: 'leave_policies',
  entity: LeavePolicy,
  excluded,
  dependsOn: [],
  columns,
  naturalKey: ['leave_type'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<LeavePolicy[]> {
    return m.find(LeavePolicy, { where: { tenant_id: tenantId } });
  },

  toRow(entity: LeavePolicy, _ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      leave_type: entity.leave_type,
      annual_quota_days: entity.annual_quota_days,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    _ctx: ImportContext,
  ): { row: LeavePolicyRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'leave_policies', rowNo);
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
        leave_type: values.leave_type as LeaveType,
        annual_quota_days: values.annual_quota_days as number,
      },
    };
  },

  keyOf(x: LeavePolicyRow | LeavePolicy): string {
    return x.leave_type;
  },

  diffFields(row: LeavePolicyRow, existing: LeavePolicy): string[] {
    const changed: string[] = [];
    if (row.leave_type !== existing.leave_type) changed.push('leave_type');
    if (row.annual_quota_days !== existing.annual_quota_days) changed.push('annual_quota_days');
    return changed;
  },

  async upsert(
    row: LeavePolicyRow,
    existing: LeavePolicy | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<LeavePolicy> {
    const policy =
      existing ??
      (await m.findOne(LeavePolicy, {
        where: { tenant_id: tenantId, leave_type: row.leave_type },
      })) ??
      new LeavePolicy();

    policy.tenant_id = tenantId;
    policy.leave_type = row.leave_type;
    policy.annual_quota_days = row.annual_quota_days;

    return m.save(LeavePolicy, policy);
  },

  async remove(entity: LeavePolicy, m: EntityManager): Promise<void> {
    await m.remove(LeavePolicy, entity);
  },
};
