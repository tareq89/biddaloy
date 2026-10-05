import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { audienceForRoles, checkPassword } from '@biddaloy/shared';
import type { UserRole } from '@biddaloy/shared';
import type { UserTenant } from './entities/user-tenant.entity';

/**
 * D7 (epic #409): the one password-strength rule shared by every endpoint
 * that ever sets a password — `ChangePasswordDto.new_password` and
 * `account-access`'s `ActivateDto.password` both import this rather than
 * each spelling out their own minimum, so the two can never disagree.
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * D10: role-based strength rules, enforced wherever a password is SET or
 * CHANGED — never at sign-in, so existing passwords keep working.
 * `roles` = the roles of ALL the user's current memberships; strictest wins
 * (empty or mixed → staff rules).
 */
export function assertPasswordAllowed(password: string, roles: UserRole[]): void {
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
