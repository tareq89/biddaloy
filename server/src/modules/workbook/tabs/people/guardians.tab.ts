import type { EntityManager } from 'typeorm';
import { CommunicationMedium } from '@biddaloy/shared';
import { Guardian } from '../../../students/entities/guardian.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `guardians` tab: parent/guardian profiles, optionally linked to a
 * `users` row for portal login.
 *
 * `entity: Guardian`, table `guardians`. `Guardian.students` (the inverse
 * side of a `ManyToMany` whose `@JoinTable('student_guardians')` lives on
 * `Student`) is deliberately not touched by this tab at all — no column,
 * no `excluded` entry (it isn't one of `Guardian`'s own columns, so the
 * completeness gate would reject listing it there). The link rows are owned
 * by the future `students` tab's `guardian_phones` column; `remove` below
 * must never delete them.
 *
 * `naturalKey: ['phone']` is not a real uniqueness guarantee: `phone` has a
 * plain index only (no `UNIQUE`) and is nullable. `keyOf` below falls back to
 * `email`, then to `full_name|relationship`, when `phone` is absent. Two
 * guardians sharing a phone (a household) collapse to one `KeyIndex` entry —
 * `KeyIndex.fromEntities` records that as a `duplicateKeys` case rather than
 * silently picking one. With `deleteByAbsence: true`, an import carrying only
 * one of two same-key guardians could soft-delete the other once the apply
 * engine lands; that is a known, accepted risk for this ticket, not a bug to
 * fix here.
 */
export interface GuardianRow {
  id: string;
  user_id: string | null;
  full_name: string;
  relationship: string;
  phone: string | null;
  email: string | null;
  alternate_phone: string | null;
  address: string | null;
  occupation: string | null;
  preferred_communication: CommunicationMedium;
  is_primary_contact: boolean;
  notifications_enabled: boolean;
  // The users tab's own natural key as written in the cell, kept alongside
  // the resolved `user_id` for parity with the row/entity branching pattern
  // used elsewhere (`teachers.tab.ts`'s `TeacherRow.user_key`). Unused by
  // `keyOf` — `phone`/`email`/`full_name|relationship` is the whole natural
  // key here.
  user_key: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'full_name',
    type: 'string',
    required: true,
    label: { en: 'Full name', bn: 'পূর্ণ নাম' },
  },
  {
    key: 'relationship',
    type: 'string',
    required: true,
    label: { en: 'Relationship', bn: 'সম্পর্ক' },
  },
  { key: 'phone', type: 'string', label: { en: 'Phone', bn: 'ফোন' } },
  { key: 'email', type: 'string', label: { en: 'Email', bn: 'ইমেইল' } },
  {
    key: 'alternate_phone',
    type: 'string',
    label: { en: 'Alternate phone', bn: 'বিকল্প ফোন' },
  },
  { key: 'address', type: 'string', label: { en: 'Address', bn: 'ঠিকানা' } },
  { key: 'occupation', type: 'string', label: { en: 'Occupation', bn: 'পেশা' } },
  {
    // Not `required`: an empty cell means "use the entity's own default",
    // handled explicitly in `fromRow` below rather than by `fromCell`.
    key: 'preferred_communication',
    type: 'enum',
    enumValues: Object.values(CommunicationMedium),
    label: { en: 'Preferred communication', bn: 'পছন্দের যোগাযোগ মাধ্যম' },
  },
  {
    // Not `required`; an empty cell defaults to `true`, matching the column
    // default (`guardian.entity.ts`).
    key: 'is_primary_contact',
    type: 'bool',
    label: { en: 'Is primary contact', bn: 'প্রাথমিক যোগাযোগ কিনা' },
  },
  {
    // Not `required`; an empty cell defaults to `true` — never `false` — so a
    // migrated guardian keeps receiving reminders unless the source data
    // explicitly opted them out (`guardian.entity.ts` docblock).
    key: 'notifications_enabled',
    type: 'bool',
    label: { en: 'Notifications enabled', bn: 'বিজ্ঞপ্তি সক্রিয়' },
  },
  {
    // The portal login is optional (`guardian.entity.ts:40-45`), so this is
    // the one ref column in the workbook that is not `required`.
    key: 'user',
    type: 'ref',
    ref: 'users',
    label: { en: 'User', bn: 'ব্যবহারকারী' },
  },
];

/**
 * `Guardian` columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `Guardian` column
 * appears in neither `columns` nor here.
 *
 * `students` is NOT listed here on purpose: it is the inverse side of a
 * `ManyToMany` (the `@JoinTable` lives on `Student`), so it never appears in
 * `Guardian`'s own column metadata, and the completeness gate rejects an
 * `excluded` entry naming a column the entity does not have.
 */
const excluded: readonly string[] = [
  'user_id', // exported instead as the `user` ref column, keyed by the referenced tab's natural key
];

const MAX_LENGTHS: Record<string, number> = {
  full_name: 100,
  relationship: 50,
  phone: 20,
  email: 100,
  alternate_phone: 20,
  occupation: 100,
};

export const guardiansTab: TabSpec<Guardian, GuardianRow> = {
  name: 'guardians',
  entity: Guardian,
  excluded,
  dependsOn: ['users'],
  columns,
  naturalKey: ['phone'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Guardian[]> {
    // `user` is loaded eagerly for `toRow`'s `user` cell. TypeORM excludes
    // soft-deleted rows from a default `find`, so a soft-deleted guardian is
    // correctly absent without passing `withDeleted`.
    return m.find(Guardian, { where: { tenant_id: tenantId }, relations: ['user'] });
  },

  toRow(entity: Guardian, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      // `user_id` is nullable here, unlike every other existing ref site —
      // guarded rather than calling `ctx.keyOf` with a possibly-null id.
      user: entity.user_id ? ctx.keyOf('users', entity.user_id) : null,
      full_name: entity.full_name,
      relationship: entity.relationship,
      phone: entity.phone,
      email: entity.email,
      alternate_phone: entity.alternate_phone,
      address: entity.address,
      occupation: entity.occupation,
      preferred_communication: entity.preferred_communication,
      is_primary_contact: entity.is_primary_contact,
      notifications_enabled: entity.notifications_enabled,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: GuardianRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'guardians', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'guardians',
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

    let userId: string | null = null;
    const userKey = (values.user as string | null) ?? null;
    if (userKey) {
      const resolved = ctx.ref('users', userKey);
      if (!resolved) {
        errors.push({
          tab: 'guardians',
          row: rowNo,
          column: 'user',
          message: `Column "user": no user with the key "${userKey}" was found.`,
          severity: 'error',
          value: userKey,
        });
      } else {
        userId = resolved;
      }
    }

    if (errors.length > 0) return { errors };

    const phone = (values.phone as string | null) ?? null;

    // Weak-key warning: `keyOf` (below) has no `ImportContext` access, so it
    // cannot warn itself. This is the one place with `ctx.warn` that also
    // knows whether this row will hit the weak-fallback branch of `keyOf`.
    // No consumer of `ctx.warn` exists yet (no import/apply service on this
    // branch) — the warning is recorded for the engine that lands later.
    if (!phone) {
      ctx.warn({
        tab: 'guardians',
        row: rowNo,
        column: 'phone',
        message:
          'Column "phone": empty. This guardian will be matched by email, or by full name + ' +
          'relationship if email is also empty — either fallback can collide with another guardian.',
        severity: 'warning',
        value: '',
      });
    }

    return {
      row: {
        id: values.id as string,
        user_id: userId,
        full_name: values.full_name as string,
        relationship: values.relationship as string,
        phone,
        email: (values.email as string | null) ?? null,
        alternate_phone: (values.alternate_phone as string | null) ?? null,
        address: (values.address as string | null) ?? null,
        occupation: (values.occupation as string | null) ?? null,
        // An empty cell defaults to the entity's own column default rather
        // than being treated as "unset" (`fromCell` already returned `null`
        // for the empty non-required cell).
        preferred_communication:
          (values.preferred_communication as CommunicationMedium | null) ?? CommunicationMedium.SMS,
        is_primary_contact: (values.is_primary_contact as boolean | null) ?? true,
        notifications_enabled: (values.notifications_enabled as boolean | null) ?? true,
        user_key: userKey,
      },
    };
  },

  // No `ImportContext`/`ExportContext` access (see `TabSpec.keyOf`), so the
  // phone -> email -> full_name|relationship fallback happens silently here.
  // The "weak key" case (no phone) is warned about from `fromRow` instead,
  // which does have `ctx.warn` — same limitation `users.tab.ts` documents at
  // its own `upsert`.
  keyOf(x: GuardianRow | Guardian): string {
    return x.phone?.trim() || x.email?.trim() || `${x.full_name}|${x.relationship}`;
  },

  diffFields(row: GuardianRow, existing: Guardian): string[] {
    const changed: string[] = [];
    const fields = [
      'user_id',
      'full_name',
      'relationship',
      'phone',
      'email',
      'alternate_phone',
      'address',
      'occupation',
      'preferred_communication',
      'is_primary_contact',
      'notifications_enabled',
    ] as const;
    for (const key of fields) {
      if (row[key] !== existing[key]) changed.push(key);
    }
    return changed;
  },

  async upsert(
    row: GuardianRow,
    existing: Guardian | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Guardian> {
    // `naturalKey: ['phone']` is not unique in the database (plain index
    // only, nullable), so `upsert` never tries to find a match by phone
    // itself — it relies on `existing` (from the engine's `KeyIndex`) plus a
    // `user_id` lookup below.
    //
    // `guardians.user_id` carries a GLOBAL unique constraint
    // (`REL_f1d05a3a2d70db0a25479b6718`), not tenant-scoped and not partial
    // on `deleted_at` — same hazard as `Teacher.employee_id`
    // (`teachers.tab.ts`), one column over. `withDeleted: true` so a
    // soft-deleted holder is revived rather than colliding with a fresh
    // insert.
    let guardian = existing;

    // Even with an `existing` match (found by the engine's `KeyIndex` on
    // phone/email/name), the row's `user` ref can still point at a
    // *different* guardian, because `keyOf` never considers `user_id`. Look
    // up that other holder before saving, or `m.save` below would hit the
    // global unique constraint as an unhandled 23505 instead of this
    // deliberate error.
    if (row.user_id && (!guardian || guardian.user_id !== row.user_id)) {
      const holder = await m.findOne(Guardian, {
        where: { user_id: row.user_id },
        withDeleted: true,
      });
      if (holder && holder.id !== guardian?.id) guardian = guardian ?? holder;
      if (holder && guardian && holder.id !== guardian.id) {
        throw new Error(
          `Guardian with user "${row.user_key ?? row.user_id}" already belongs to a different ` +
            `guardian record (tenant "${holder.tenant_id}") and cannot be reassigned by a restore.`,
        );
      }
    }

    if (guardian && guardian.tenant_id !== tenantId) {
      // A cross-tenant user_id collision is a genuine data conflict, not
      // something `upsert` can silently resolve by re-tenanting another
      // school's guardian. `upsert` has no `ImportContext` (`tab-spec.ts`),
      // so it cannot emit a `RowError`/warning — throw a clear error naming
      // both tenants instead, the deliberate exception to "never throw."
      throw new Error(
        `Guardian with user "${row.user_key ?? row.user_id}" already exists in tenant ` +
          `"${guardian.tenant_id}" and cannot be restored into tenant "${tenantId}".`,
      );
    }

    if (guardian) {
      guardian.deleted_at = null;
    } else {
      guardian = new Guardian();
    }

    guardian.tenant_id = tenantId;
    guardian.user_id = row.user_id;
    guardian.full_name = row.full_name;
    guardian.relationship = row.relationship;
    guardian.phone = row.phone;
    guardian.email = row.email;
    guardian.alternate_phone = row.alternate_phone;
    guardian.address = row.address;
    guardian.occupation = row.occupation;
    guardian.preferred_communication = row.preferred_communication;
    guardian.is_primary_contact = row.is_primary_contact;
    guardian.notifications_enabled = row.notifications_enabled;
    // `students` link rows are owned by the future students tab's
    // `guardian_phones` column; never touched here.

    return m.save(Guardian, guardian);
  },

  async remove(entity: Guardian, m: EntityManager): Promise<void> {
    await m.softRemove(Guardian, entity);
  },
};
