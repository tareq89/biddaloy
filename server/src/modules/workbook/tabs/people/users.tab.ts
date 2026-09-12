import type { EntityManager } from 'typeorm';
import { In, Not } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { User } from '../../../users/entities/user.entity';
import { UserTenant } from '../../../auth/entities/user-tenant.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `users` tab: one row per tenant member, carrying identity (`email`,
 * `phone`, `full_name`) plus that member's role in *this* tenant — never a
 * credential.
 *
 * `entity: User` (not `UserTenant`): `KeyIndex.fromEntities` publishes
 * `entity.id` (`codec/key-index.ts`), and every later people tab resolving
 * `ctx.ref('users', email)` needs a `users.id`, not a `user_tenants.id`.
 *
 * Deliberately un-exported `UserTenant` columns (not in `excluded` below,
 * because the completeness gate only checks columns of `tab.entity = User`):
 * `user_id` (implied by which user the row belongs to) and `metadata`
 * (per-membership bookkeeping, not identity/role data this tab carries).
 */
export interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  role: UserRole;
}

/** SUPER_ADMIN is a platform role, never restored from a tenant backup. */
const EXPORTABLE_ROLES = Object.values(UserRole).filter((r) => r !== UserRole.SUPER_ADMIN);

/** Declaration precedence used by `toRow` when a user holds more than one
 * role in the tenant (legal per `@Unique(['user_id','tenant_id','role'])`).
 * This tab is identity + role only (D2); the second role is not represented,
 * a documented fidelity gap, not a bug. */
const ROLE_PRECEDENCE: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.PARENT,
  UserRole.STUDENT,
];

/** Picks the row's role from a user's memberships in one tenant, by
 * declaration precedence. Throws if `memberships` is empty — `load` always
 * attaches at least one non-SUPER_ADMIN membership, so an empty array here
 * means a caller reused this on a `User` it did not load through this tab. */
export function pickRole(memberships: readonly UserTenant[]): UserRole {
  for (const role of ROLE_PRECEDENCE) {
    if (memberships.some((ut) => ut.role === role)) return role;
  }
  throw new TypeError('pickRole: no non-SUPER_ADMIN membership found.');
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'email', type: 'string', label: { en: 'Email', bn: 'ইমেইল' } },
  { key: 'phone', type: 'string', label: { en: 'Phone', bn: 'ফোন' } },
  {
    key: 'full_name',
    type: 'string',
    required: true,
    label: { en: 'Full name', bn: 'পূর্ণ নাম' },
  },
  {
    key: 'role',
    type: 'enum',
    required: true,
    enumValues: EXPORTABLE_ROLES,
    label: { en: 'Role', bn: 'ভূমিকা' },
  },
];

/**
 * `User` columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `User` column
 * appears in neither `columns` nor here, so this list is the record of a
 * decision rather than an oversight.
 */
const excluded: readonly string[] = [
  'password_hash', // a credential never leaves the system; restored users re-onboard through the Epic 12 invitation flow
  'email_verified_at', // proof of ownership is established in the destination, not transplanted from a file
  'phone_verified_at', // see `email_verified_at`
  'status', // lifecycle state of the destination account
  'profile_picture_url', // the image lives in the storage bucket; a workbook cannot carry it
  'preferences', // per-user UI state, not tenant data
  'last_login_at', // destination's own audit history
];

const MAX_LENGTHS: Record<string, number> = {
  email: 100,
  phone: 20,
  full_name: 100,
};

export const usersTab: TabSpec<User, UserRow> = {
  name: 'users',
  entity: User,
  excluded,
  dependsOn: ['school'],
  columns,
  naturalKey: ['email'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<User[]> {
    // The membership filter lives in the ON clause of the join, not a WHERE
    // clause: a WHERE would still load every tenant's memberships onto the
    // entity (just filtering which *users* qualify), leaking other tenants'
    // roles into `user.user_tenants`. The ON clause instead means
    // `user.user_tenants` holds only this tenant's non-SUPER_ADMIN
    // memberships — which is exactly what `toRow` and `remove` read. A user
    // whose only membership here is SUPER_ADMIN never appears at all.
    return m
      .createQueryBuilder(User, 'user')
      .innerJoinAndSelect(
        'user.user_tenants',
        'ut',
        'ut.tenant_id = :tenantId AND ut.role != :superAdmin',
        { tenantId, superAdmin: UserRole.SUPER_ADMIN },
      )
      .getMany();
  },

  toRow(entity: User, _ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      email: entity.email,
      phone: entity.phone,
      full_name: entity.full_name,
      role: pickRole(entity.user_tenants ?? []),
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    _ctx: ImportContext,
  ): { row: UserRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'users', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      // The entity's varchar bounds, checked here rather than left to
      // Postgres, so an over-long cell costs one cell rather than aborting
      // the whole restore with a 22001.
      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'users',
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

    // Belt and braces: `enumValues` already omits SUPER_ADMIN, so this only
    // matters if that list is ever widened by mistake.
    if (values.role === UserRole.SUPER_ADMIN) {
      errors.push({
        tab: 'users',
        row: rowNo,
        column: 'role',
        message: 'Column "role": the platform SUPER_ADMIN role is never restored from a backup.',
        severity: 'error',
        value: cells.role ?? '',
      });
    }

    if (errors.length > 0) return { errors };

    const email = values.email as string | null;
    const phone = values.phone as string | null;

    if (!email && !phone) {
      errors.push({
        tab: 'users',
        row: rowNo,
        column: null,
        message:
          'Every user needs an email or a phone number; this row has neither, so nothing can reference it.',
        severity: 'error',
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        email,
        phone,
        full_name: values.full_name as string,
        role: values.role as UserRole,
      },
    };
  },

  // The key is the email text (falling back to phone), never a uuid: ids
  // differ between the source and destination tenants, but email/phone are
  // globally stable identity.
  keyOf(x: UserRow | User): string {
    return x.email?.trim() || x.phone?.trim() || '';
  },

  diffFields(row: UserRow, existing: User): string[] {
    const changed: string[] = [];
    for (const key of ['email', 'phone', 'full_name'] as const) {
      if (row[key] !== existing[key]) changed.push(key);
    }
    // `diffFields` has no `EntityManager`, so it cannot see whether this
    // user has memberships outside the destination tenant; for a shared
    // user it may report an identity field that `upsert` then declines to
    // change. The diff preview is advisory only, not what actually writes.
    //
    // `pickRole` throws on an empty membership list; `load` always attaches
    // at least one, but `diffFields` is advisory, so a caller passing an
    // entity loaded some other way must not crash the preview — treat an
    // unreadable current role as "changed" instead.
    let currentRole: UserRole | null = null;
    try {
      currentRole = pickRole(existing.user_tenants ?? []);
    } catch {
      // fall through: no readable current role means the preview can't
      // confirm "unchanged," so it reports a change.
    }
    if (row.role !== currentRole) changed.push('role');
    return changed;
  },

  async upsert(
    row: UserRow,
    existing: User | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<User> {
    // Deliberately not tenant-scoped: `User.email`/`User.phone` are globally
    // unique (`user.entity.ts`), so a tenant-scoped lookup would guarantee a
    // unique-constraint crash on insert when the user already exists
    // elsewhere.
    let user =
      existing ?? (row.email ? await m.findOne(User, { where: { email: row.email } }) : null);
    user = user ?? (row.phone ? await m.findOne(User, { where: { phone: row.phone } }) : null);

    if (user) {
      const sharedElsewhere =
        (await m.count(UserTenant, {
          where: { user_id: user.id, tenant_id: Not(tenantId) },
        })) > 0;

      // Never edit identity fields of a user who belongs to another tenant
      // too: this is the safe half of "shared users keep their identity
      // untouched." Surfacing a warning to the importer belongs to the
      // apply service that owns the `ImportContext` — `upsert` here has no
      // ctx parameter (`tab-spec.ts`), so it cannot call `ctx.warn` itself.
      if (!sharedElsewhere) {
        // A row missing a field (e.g. no phone on this export) must not
        // erase a value the destination already has — only a present
        // imported value overwrites; absence is "unchanged," not "clear."
        user.email = row.email ?? user.email;
        user.phone = row.phone ?? user.phone;
        user.full_name = row.full_name;
      }
    } else {
      user = new User();
      user.email = row.email;
      user.phone = row.phone;
      user.full_name = row.full_name;
      // Re-onboarding happens through the Epic 12 invitation flow.
      user.password_hash = null;
    }

    user = await m.save(User, user);

    const memberships = await m.find(UserTenant, {
      where: { user_id: user.id, tenant_id: tenantId },
    });
    const alreadyCorrect = memberships.find((ut) => ut.role === row.role);

    if (!alreadyCorrect) {
      // EXEMPTION, mirrors `remove()`'s own comment: the membership
      // `ProvisioningService.provision` created for this school's own admin
      // must never have its role changed by an uploaded workbook, any more
      // than it can be deleted by absence. Without this, a workbook whose
      // `users` sheet happens to list this same email (e.g. restoring
      // another school's backup right after provisioning, or the admin
      // simply appearing at a lower role in the source tenant) would demote
      // or replace the very account the school owner needs to sign back in
      // with — the workbook is untrusted input, and downgrading is just as
      // damaging here as deleting outright. Narrow: only this one tagged
      // row is protected; every other membership still updates normally.
      const provisioned = memberships.find(
        (ut) => (ut.metadata as { provisioned?: boolean } | null)?.provisioned,
      );

      if (provisioned) {
        const stale = memberships.filter((ut) => ut.id !== provisioned.id).map((ut) => ut.id);
        if (stale.length > 0) await m.delete(UserTenant, { id: In(stale) });
      } else if (memberships.length > 0) {
        // Update in place: inserting a second row for the same
        // (user_id, tenant_id) would violate
        // `@Unique(['user_id','tenant_id','role'])` on a re-run.
        memberships[0].role = row.role;
        await m.save(UserTenant, memberships[0]);
        // This tab represents one role per tenant per user (D2); any other
        // stale membership rows for this tenant would otherwise survive the
        // restore as an extra, no-longer-intended role.
        const stale = memberships.slice(1).map((ut) => ut.id);
        if (stale.length > 0) await m.delete(UserTenant, { id: In(stale) });
      } else {
        await m.save(
          UserTenant,
          m.create(UserTenant, {
            user_id: user.id,
            tenant_id: tenantId,
            role: row.role,
            metadata: null,
          }),
        );
      }
    }

    // Re-read so the returned entity's role reflects what was written, for
    // any caller that reuses it (keeps `diffFields`/`keyOf` consistent).
    user.user_tenants = await m.find(UserTenant, {
      where: { user_id: user.id, tenant_id: tenantId },
    });

    return user;
  },

  remove(entity: User, m: EntityManager): Promise<void> {
    // The ids come from `load(tenantId)`'s tenant-filtered join, so this can
    // never reach another tenant's membership. Hard delete because
    // `UserTenant` has no `deleted_at`. The `User` itself is never deleted:
    // it may be a member elsewhere.
    //
    // EXEMPTION: never remove the membership `ProvisioningService.provision`
    // itself created (tagged `metadata.provisioned === true`). Restoring a
    // workbook from another school right after creating this one is the
    // headline flow this exists for — that workbook's `users` sheet only
    // ever lists the SOURCE school's users, so the brand-new admin is
    // legitimately absent from it, and `deleteByAbsence` must not read that
    // absence as "delete the school's own just-invited admin." Kept narrow:
    // only this one tag is exempt, every other absent membership still gets
    // removed exactly as before.
    const ids = (entity.user_tenants ?? [])
      .filter((ut) => !(ut.metadata as { provisioned?: boolean } | null)?.provisioned)
      .map((ut) => ut.id);
    if (ids.length === 0) return Promise.resolve();
    return m.delete(UserTenant, { id: In(ids) }).then(() => undefined);
  },
};
