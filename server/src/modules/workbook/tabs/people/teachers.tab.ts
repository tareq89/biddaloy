import type { EntityManager } from 'typeorm';
import { TeacherDesignation } from '@biddaloy/shared';
import { Teacher } from '../../../academics/entities/teacher.entity';
import { fromCell, formatDateOnly } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `teachers` tab: staff profiles extending a `users` row.
 *
 * `entity: Teacher`, table `teachers`. `employee_id` is the natural key —
 * globally unique across every tenant (`teacher.entity.ts`), not just this
 * one, which is what makes `upsert` below unusual (see C6 in the issue
 * #591 plan).
 *
 * `designations` is a Postgres enum array on the entity, but is exported as
 * a plain `;`-joined `string` column rather than `ref-list`: a `ref-list`
 * column must name a `ref` target that is itself a registered tab
 * (`registry.ts`), and `TeacherDesignation` is an enum, not a tab. If a
 * later lane adds an `enum-list` `ColumnType`, this column should migrate
 * to it.
 */
export interface TeacherRow {
  id: string;
  user_id: string;
  employee_id: string;
  designations: TeacherDesignation[];
  subject_specialization: string | null;
  joining_date: string | null; // 'YYYY-MM-DD', as fromCell('date') yields
  // The users tab's own natural key (email, falling back to phone), kept
  // alongside the resolved `user_id` so `keyOf` could build the same string
  // for a row as for an entity should the natural key ever grow to include
  // it. Unused by `keyOf` today — `employee_id` alone is the whole natural
  // key — but kept for parity with the row/entity branching pattern used
  // elsewhere (`sections.tab.ts`, `classes.tab.ts`).
  user_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'user',
    type: 'ref',
    ref: 'users',
    required: true,
    label: { en: 'User', bn: 'ব্যবহারকারী' },
  },
  {
    key: 'employee_id',
    type: 'string',
    required: true,
    label: { en: 'Employee ID', bn: 'কর্মচারী আইডি' },
  },
  {
    // Documentary only: `fromCell` never consults `enumValues` for
    // `type: 'string'` (`cell-format.ts`); the real check against
    // `TeacherDesignation` happens by hand in `fromRow` below. Kept here so
    // a future dropdown generator has the allowed list to read.
    key: 'designations',
    type: 'string',
    enumValues: Object.values(TeacherDesignation),
    label: { en: 'Designations', bn: 'পদবি' },
  },
  {
    // `Teacher.subject_specialization` is `@deprecated since [9.1]` on the
    // entity, but a backup must round-trip whatever a destination already
    // has stored there, so it stays exported rather than moving to `excluded`.
    key: 'subject_specialization',
    type: 'string',
    label: { en: 'Subject specialization', bn: 'বিষয় বিশেষজ্ঞতা' },
  },
  {
    key: 'joining_date',
    type: 'date',
    label: { en: 'Joining date', bn: 'যোগদানের তারিখ' },
  },
];

/**
 * `Teacher` columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `Teacher` column
 * appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'user_id', // exported instead as the `user` ref column, keyed by the referenced tab's natural key
];

const MAX_LENGTHS: Record<string, number> = {
  employee_id: 50,
  subject_specialization: 100,
};

export const teachersTab: TabSpec<Teacher, TeacherRow> = {
  name: 'teachers',
  entity: Teacher,
  excluded,
  dependsOn: ['users'],
  columns,
  naturalKey: ['employee_id'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Teacher[]> {
    // `user` is loaded eagerly: `toRow`'s `user` cell and `keyOf`'s
    // user-key fragment both need it. TypeORM excludes soft-deleted rows
    // from a default `find`, so a soft-deleted teacher is correctly absent
    // without passing `withDeleted`.
    return m.find(Teacher, { where: { tenant_id: tenantId }, relations: ['user'] });
  },

  toRow(entity: Teacher, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      user: ctx.keyOf('users', entity.user_id),
      employee_id: entity.employee_id,
      // Joined explicitly rather than via `toCell('string', ...)`, which
      // would `String(array)` into a comma-joined `"A,B"` instead of `;`.
      designations: (entity.designations ?? []).join(';'),
      subject_specialization: entity.subject_specialization,
      joining_date: entity.joining_date,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: TeacherRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'teachers', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'teachers',
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

    let userId: string | undefined;
    const userKey = values.user as string;
    if (userKey) {
      userId = ctx.ref('users', userKey);
      if (!userId) {
        errors.push({
          tab: 'teachers',
          row: rowNo,
          column: 'user',
          message: `Column "user": no user with the key "${userKey}" was found.`,
          severity: 'error',
          value: userKey,
        });
      }
    }

    // `designations` is a `;`-joined string, hand-validated against
    // `TeacherDesignation` because `fromCell` only checks `enumValues` for
    // `type: 'enum'`, not `type: 'string'` (cell-format.ts).
    const designationsText = (values.designations as string | null) ?? '';
    const tokens = designationsText
      .split(';')
      .map((t) => t.trim())
      .filter((t) => t !== '');
    const designations: TeacherDesignation[] = [];
    for (const token of tokens) {
      if (!(Object.values(TeacherDesignation) as string[]).includes(token)) {
        errors.push({
          tab: 'teachers',
          row: rowNo,
          column: 'designations',
          message: `Column "designations": "${token}" is not one of the allowed values: ${Object.values(
            TeacherDesignation,
          ).join(', ')}.`,
          severity: 'error',
          value: designationsText,
        });
        continue;
      }
      designations.push(token as TeacherDesignation);
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        user_id: userId as string,
        employee_id: values.employee_id as string,
        designations,
        subject_specialization: (values.subject_specialization as string | null) ?? null,
        joining_date: (values.joining_date as string | null) ?? null,
        user_key: userKey,
      },
    };
  },

  // `employee_id` is the whole natural key: human-readable text, never a
  // uuid, and already identical on both the row and the entity branch.
  keyOf(x: TeacherRow | Teacher): string {
    return x.employee_id;
  },

  diffFields(row: TeacherRow, existing: Teacher): string[] {
    const changed: string[] = [];
    if (row.user_id !== existing.user_id) changed.push('user_id');
    if (row.employee_id !== existing.employee_id) changed.push('employee_id');
    if (row.subject_specialization !== existing.subject_specialization) {
      changed.push('subject_specialization');
    }
    const rowJoiningDate = row.joining_date;
    const existingJoiningDate = existing.joining_date
      ? formatDateOnly(existing.joining_date)
      : null;
    if (rowJoiningDate !== existingJoiningDate) changed.push('joining_date');

    // A Postgres enum array's order is not meaningful, so compare as sets —
    // otherwise an unchanged teacher shows up as changed whenever the
    // database happens to return the designations in a different order.
    const rowSet = [...row.designations].sort().join(',');
    const existingSet = [...(existing.designations ?? [])].sort().join(',');
    if (rowSet !== existingSet) changed.push('designations');

    return changed;
  },

  async upsert(
    row: TeacherRow,
    existing: Teacher | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Teacher> {
    // Deliberately not tenant-scoped: `Teacher.employee_id` is globally
    // unique (`teacher.entity.ts`), so a tenant-scoped lookup would miss a
    // holder in another tenant and the insert below would die with a 23505
    // that takes the whole restore with it (same hazard as `User.email` in
    // `users.tab.ts`).
    //
    // `withDeleted: true`: the unique constraint is not partial on
    // `deleted_at` (`1784175065078-InitialSchema.ts:175`), so a
    // soft-deleted teacher still owns its `employee_id`. A found
    // soft-deleted row must be revived, not re-inserted into a duplicate.
    let teacher =
      existing ??
      (await m.findOne(Teacher, { where: { employee_id: row.employee_id }, withDeleted: true }));

    if (teacher && teacher.tenant_id !== tenantId) {
      // A cross-tenant employee_id collision is a genuine data conflict, not
      // something `upsert` can silently resolve by re-tenanting another
      // school's teacher. `upsert` has no `ImportContext` (`tab-spec.ts`),
      // so it cannot emit a `RowError`/warning — throw a clear error naming
      // both tenants instead, the deliberate exception to "never throw."
      throw new Error(
        `Teacher with employee_id "${row.employee_id}" already exists in tenant ` +
          `"${teacher.tenant_id}" and cannot be restored into tenant "${tenantId}".`,
      );
    }

    if (teacher) {
      teacher.deleted_at = null;
    } else {
      teacher = new Teacher();
    }

    teacher.tenant_id = tenantId;
    teacher.user_id = row.user_id;
    teacher.employee_id = row.employee_id;
    teacher.designations = row.designations;
    teacher.subject_specialization = row.subject_specialization;
    teacher.joining_date = row.joining_date ? new Date(row.joining_date) : null;

    return m.save(Teacher, teacher);
  },

  async remove(entity: Teacher, m: EntityManager): Promise<void> {
    await m.softRemove(Teacher, entity);
  },
};
