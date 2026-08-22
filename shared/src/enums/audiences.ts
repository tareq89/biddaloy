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
 */
export const GUARDIAN_ROLES = [UserRole.PARENT, UserRole.STUDENT] as const;

export const STAFF_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.EXECUTIVE,
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
