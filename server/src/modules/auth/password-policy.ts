import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { audienceForRoles, checkPassword } from '@biddaloy/shared';
import type { UserRole } from '@biddaloy/shared';
import { BCRYPT_MAX_BYTES } from './password-hash';
import type { UserTenant } from './entities/user-tenant.entity';

/**
 * D7 (epic #409): the one minimum length shared by every endpoint that sets a
 * password — the DTOs import it from here, and it is the same constant the
 * `minLength` rule in `@biddaloy/shared` checks, so they can never disagree.
 */
export { PASSWORD_MIN_LENGTH } from '@biddaloy/shared';

/**
 * D10: role-based strength rules, enforced wherever a password is SET or
 * CHANGED — never at sign-in, so existing passwords keep working.
 * `roles` = the roles of ALL the user's current memberships; strictest wins
 * (empty or mixed → staff rules).
 */
export function assertPasswordAllowed(password: string, roles: UserRole[]): void {
  // bcrypt silently ignores bytes past 72, so a longer NEW password would not mean
  // what the user typed. Never checked at sign-in: old long passwords keep working.
  if (Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_BYTES) {
    throw new BadRequestException({
      message: 'Password is too long',
      details: { code: 'PASSWORD_TOO_LONG', maxBytes: BCRYPT_MAX_BYTES },
    });
  }
  const failed = checkPassword(password, audienceForRoles(roles))
    .filter((r) => !r.ok)
    .map((r) => r.id);
  if (failed.length > 0) {
    throw new BadRequestException({
      message: 'Password does not meet the rules',
      details: { code: 'PASSWORD_TOO_WEAK', failed },
    });
  }
}

/** `assertPasswordAllowed` for a user id — loads the roles of all their memberships. */
export async function assertPasswordAllowedForUser(
  userTenantRepo: Repository<UserTenant>,
  userId: string,
  password: string,
): Promise<void> {
  const memberships = await userTenantRepo.find({ where: { user_id: userId } });
  assertPasswordAllowed(
    password,
    memberships.map((m) => m.role),
  );
}
