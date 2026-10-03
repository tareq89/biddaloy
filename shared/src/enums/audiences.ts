import { UserRole } from './index';

/**
 * The two audiences [8.9.10]'s single SPA splits its route tree on.
 *
 * **Not a new ACL.** `ROLE_PERMISSIONS` still decides what a role may *do*,
 * and the server's `RolesGuard`/`ContextGuard` still decide what it may
 * reach. These lists answer a narrower question: which shell a role lives
 * in — staff chrome at `/dashboard`, `/students`, … or the family-facing
 * portal at `/portal`.
 *
 * Audience rather than role is the seam because `ROLE_PERMISSIONS[PARENT]`
 * and `ROLE_PERMISSIONS[STUDENT]` are byte-identical
 * (`[STUDENT_READ, FEE_READ, INVOICE_READ]`) — a route tree per role would
 * be two copies of the same tree on day one.
 *
 * Both lists are written out rather than one being derived as "everything
 * else": a role added later must be placed deliberately, and
 * `audiences.spec.ts` fails if any `UserRole` is in neither list or both.
 *
 * `ROLE_SCOPE` answers a third question: how much *data* a role may see —
 * the whole tenant, only its assigned sections, its family, or itself. It is
 * the one role-to-data-scope map every consumer reads, instead of each
 * module hard-coding role checks. An unknown role has no scope (fail closed).
 */
export const GUARDIAN_ROLES = [UserRole.PARENT, UserRole.STUDENT] as const;

export const STAFF_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.EXECUTIVE,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
] as const;

/** Takes `string | null` — the shape `auth-state.ts`'s `getActiveRole()`
 * returns, since the active role is decoded from a JWT and is only as
 * trustworthy as that. An unknown or absent role is not a guardian; the
 * caller's own guard decides what to do with it. */
export function isGuardianRole(role: string | null | undefined): boolean {
  return (GUARDIAN_ROLES as readonly string[]).includes(role as string);
}

export function isStaffRole(role: string | null | undefined): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role as string);
}

export enum RoleScope {
  TENANT = 'TENANT',
  ASSIGNED_SECTIONS = 'ASSIGNED_SECTIONS',
  FAMILY = 'FAMILY',
  SELF = 'SELF',
}

export const ROLE_SCOPE: Record<UserRole, RoleScope> = {
  [UserRole.SUPER_ADMIN]: RoleScope.TENANT,
  [UserRole.ADMIN]: RoleScope.TENANT,
  [UserRole.ACCOUNTANT]: RoleScope.TENANT,
  [UserRole.EXECUTIVE]: RoleScope.TENANT,
  [UserRole.OFFICE_STAFF]: RoleScope.TENANT,
  [UserRole.EXAM_CONTROLLER]: RoleScope.TENANT,
  [UserRole.COMMITTEE]: RoleScope.TENANT,
  [UserRole.TEACHER]: RoleScope.ASSIGNED_SECTIONS,
  [UserRole.PARENT]: RoleScope.FAMILY,
  [UserRole.STUDENT]: RoleScope.SELF,
};

/** Null for an unknown or absent role — callers must treat that as "sees nothing". */
export function roleScope(role: string | null | undefined): RoleScope | null {
  if (!role || !Object.prototype.hasOwnProperty.call(ROLE_SCOPE, role)) return null;
  return ROLE_SCOPE[role as UserRole];
}

export function hasTenantScope(role: string | null | undefined): boolean {
  return roleScope(role) === RoleScope.TENANT;
}
