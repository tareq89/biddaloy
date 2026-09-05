import type { InvitationStatus } from '@biddaloy/shared';
import type { User } from '../users/entities/user.entity';
import type { AuthToken } from './entities/auth-token.entity';

/**
 * Pure derivation of a user's invitation lifecycle (12.1's D1) — no new
 * `UserStatus` value, just `password_hash` plus the newest `INVITE`
 * `auth_tokens` row.
 */
export function deriveInvitationStatus(
  user: Pick<User, 'password_hash'>,
  latest: AuthToken | null,
  now: Date = new Date(),
): InvitationStatus {
  if (user.password_hash) return 'ACTIVATED';
  if (!latest) return 'NONE';
  if (latest.consumed_at) return 'ACTIVATED';
  if (latest.revoked_at) return 'REVOKED';
  if (latest.expires_at.getTime() < now.getTime()) return 'EXPIRED';
  return 'PENDING';
}
