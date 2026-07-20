import { UserRole } from '../enums';

/**
 * A single membership entry stored in the JWT.
 * Represents one role the user holds within one school/tenant.
 */
export interface JwtMembership {
  tenantId: string;
  role: UserRole;
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
}

/**
 * Response returned by the POST /auth/login endpoint.
 */
export interface LoginResponse {
  access_token: string;
  memberships: JwtMembership[];
}