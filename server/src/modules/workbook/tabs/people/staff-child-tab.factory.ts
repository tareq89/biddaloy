import type { EntityManager, EntityTarget } from 'typeorm';
import { usersTab } from './users.tab';
import { fromCell } from '../../codec/cell-format';
import type { ColumnSpec, ExportContext, ImportContext, RowError, TabSpec } from '../../codec/tab-spec';

/**
 * [23.5] Shared shape for every wave-1 "one row per staff member" tab
 * (family members, addresses, experience, education, training,
 * achievements, languages, the HR core record): a `tenant_id` +
 * `staff_user_id` FK to `User`, plus a handful of plain fields with no
 * other cross-tab reference. Rather than hand-writing eight near-identical
 * `TabSpec`s (the pattern `teacher-assignments.tab.ts` uses for a tab with
 * more than one ref, and which none of these need), this factory builds
 * one from a field list — the entity's own property names, since every one
 * of these entities happens to name its columns identically to what the
 * workbook column should be called.
 *
 * `staff-designation-history.tab.ts` (two refs: staff *and* designation)
 * and `staff-document.tab.ts` (an enum plus storage metadata) don't fit
 * this shape and are hand-written instead.
 */
export type StaffFieldType = 'string' | 'date' | 'int' | 'enum' | 'bool';

export interface StaffFieldSpec {
  key: string; // both the column key and the entity's own property name
  type: StaffFieldType;
  required?: boolean;
  enumValues?: readonly string[];
  label: { en: string; bn: string };
}

export interface StaffChildTabOptions<E> {
  name: string;
  entityClass: new () => E;
  fields: readonly StaffFieldSpec[];
  /** Column keys (from `fields`, plus the implicit `staff`) that make up
   * the natural key. `staff` is prepended automatically. */
  naturalKeyFields: readonly string[];
  /** The entity's own FK property name to `User` (without `_id`/relation
   * suffix) — `staff_user` for most of these entities, but `user` for
   * `StaffHrRecord` (23.1 D1's own naming). Defaults to `staff_user`. */
  staffFkKey?: string;
}

export function createStaffChildTab<E extends { id: string }>(
  opts: StaffChildTabOptions<E>,
): TabSpec<E, Record<string, unknown>> {
  const { name, entityClass, fields, naturalKeyFields, staffFkKey = 'staff_user' } = opts;
  const staffFkIdKey = `${staffFkKey}_id`;
  const entity = entityClass as EntityTarget<E>;

  const columns: readonly ColumnSpec[] = [
    { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
    { key: 'staff', type: 'ref', ref: 'users', required: true, label: { en: 'Staff', bn: 'কর্মী' } },
    ...fields.map((f) => ({
      key: f.key,
      type: f.type,
      required: f.required,
      enumValues: f.enumValues,
      label: f.label,
    })),
  ];

  const naturalKey = ['staff', ...naturalKeyFields];

  return {
    name,
    entity,
    excluded: [staffFkIdKey], // exported instead as the `staff` ref column
    dependsOn: ['users'],
    columns,
    naturalKey,
    deleteByAbsence: true,

    load(tenantId: string, m: EntityManager): Promise<E[]> {
      return m.find(entityClass, {
        where: { tenant_id: tenantId } as never,
        relations: [staffFkKey],
      });
    },

    toRow(row: E, ctx: ExportContext): Record<string, unknown> {
      const rowRec = row as unknown as Record<string, unknown>;
      const out: Record<string, unknown> = {
        id: rowRec.id,
        staff: ctx.keyOf('users', rowRec[staffFkIdKey] as string),
      };
      for (const f of fields) {
        out[f.key] = (row as unknown as Record<string, unknown>)[f.key];
      }
      return out;
    },

    fromRow(
      cells: Record<string, string>,
      rowNo: number,
      ctx: ImportContext,
    ): { row: Record<string, unknown> } | { errors: RowError[] } {
      const errors: RowError[] = [];
      const values: Record<string, unknown> = {};

      for (const column of columns) {
        const raw = cells[column.key] ?? '';
        const result = fromCell(column, raw, name, rowNo);
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
          tab: name,
          row: rowNo,
          column: 'staff',
          message: `Column "staff": no user with the key "${staffKey}" was found.`,
          severity: 'error',
          value: staffKey,
        });
      }

      if (errors.length > 0) return { errors };

      const out: Record<string, unknown> = {
        id: values.id,
        [staffFkIdKey]: staffUserId,
        staff_key: staffKey,
      };
      for (const f of fields) {
        out[f.key] = values[f.key] ?? null;
      }
      return { row: out };
    },

    keyOf(x: Record<string, unknown> | E): string {
      const isEntity = x instanceof entityClass;
      const rec = x as unknown as Record<string, unknown>;
      const staffKey = isEntity
        ? rec[staffFkKey]
          ? usersTab.keyOf(rec[staffFkKey] as never)
          : ''
        : (rec.staff_key as string) ?? '';
      const rest = naturalKeyFields.map((key) => {
        const raw = isEntity
          ? (x as unknown as Record<string, unknown>)[key]
          : (x as Record<string, unknown>)[key];
        return raw == null ? '' : String(raw);
      });
      return [staffKey, ...rest].join('|');
    },

    diffFields(row: Record<string, unknown>, existing: E): string[] {
      const changed: string[] = [];
      const existingRec = existing as unknown as Record<string, unknown>;
      for (const f of fields) {
        const before = existingRec[f.key];
        const after = row[f.key];
        const beforeText = before instanceof Date ? before.toISOString().slice(0, 10) : before;
        if ((beforeText ?? null) !== (after ?? null)) changed.push(f.key);
      }
      return changed;
    },

    async upsert(
      row: Record<string, unknown>,
      existing: E | null,
      tenantId: string,
      m: EntityManager,
    ): Promise<E> {
      const entityInstance = (existing ?? new entityClass()) as unknown as Record<string, unknown>;
      entityInstance.tenant_id = tenantId;
      entityInstance[staffFkIdKey] = row[staffFkIdKey];
      for (const f of fields) {
        entityInstance[f.key] = row[f.key] ?? null;
      }
      return (m.save as (target: unknown, entity: unknown) => Promise<E>)(
        entityClass,
        entityInstance,
      );
    },

    async remove(row: E, m: EntityManager): Promise<void> {
      await m.remove(entityClass, row as never);
    },
  };
}
