import { UserRole } from '../enums';

/**
 * A single membership entry stored in the JWT.
 * Represents one role the user holds within one school/tenant.
 */
export interface JwtMembership {
  tenantId: string;
  role: UserRole;
  /** The school's display name — [8.9.5]'s picker/top-bar decode this
   * straight off the access token rather than fetching it separately.
   * Optional: a token issued before this field existed (or before a school
   * rename has propagated through a refresh) stays valid for up to its
   * remaining lifetime, so consumers must fall back to a placeholder rather
   * than assume this is always present. */
  name?: string;
}

/**
 * Payload embedded in the JWT after successful authentication.
 *
 * Contains a `memberships` array instead of a single role/tenantId,
 * enabling the multi-tenant / multi-role pattern. The client selects
 * an active context via the `X-Tenant-ID` header on each request.
 */
export interface JwtPayload {
  sub: string;
  email: string | null;
  phone: string | null;
  memberships: JwtMembership[];
  // Unique per access token — lets a single token be revoked early (see
  // AccessTokenDenylistService) without needing a blacklist of every
  // issued token, since the token's own lifetime is now short.
  jti: string;
}

/**
 * Response returned by the POST /auth/login endpoint.
 */
export interface LoginResponse {
  access_token: string;
  memberships: JwtMembership[];
}

/**
 * A user's account-access lifecycle state (12.1's D1), derived — never
 * stored — from `users.password_hash` plus the newest `auth_tokens` row
 * with `purpose = 'INVITE'`:
 * - `NONE` — no password, no invite was ever issued.
 * - `PENDING` — the newest invite is still live (not expired/consumed/revoked).
 * - `EXPIRED` — the newest invite is past its `expires_at`, never consumed.
 * - `REVOKED` — the newest invite was explicitly revoked.
 * - `ACTIVATED` — the user has a password (set directly, or via consuming
 *   an invite).
 */
export type InvitationStatus = 'NONE' | 'PENDING' | 'EXPIRED' | 'REVOKED' | 'ACTIVATED';
