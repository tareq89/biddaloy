import { JwtPayload, JwtMembership, UserRole } from '@beton-boi/shared';

/**
 * Auth Helper for Tests
 *
 * Provides utilities to generate JWT tokens for test users
 * without needing to hit the real login endpoint.
 */

// Re-export the JWT payload structure for convenience
export type { JwtPayload, JwtMembership };

/**
 * Creates a JWT payload for a test user.
 * Use this with a JwtService to sign a token.
 *
 * @param userId - The user's UUID
 * @param tenantId - The tenant/school UUID
 * @param role - The user's role in this tenant
 * @param email - Optional email
 * @returns JwtPayload object
 */
export function createTestJwtPayload(
  userId: string,
  tenantId: string,
  role: UserRole,
  email?: string,
): JwtPayload {
  return {
    sub: userId,
    email: email ?? null,
    phone: null,
    memberships: [
      {
        tenantId,
        role,
      },
    ],
  };
}

/**
 * Creates a mock request object with the given tenant context.
 * Useful for testing guards in isolation.
 */
export function createMockRequest(
  tenantId: string,
  role: UserRole,
  userId: string = 'test-user-id',
  headers?: Record<string, string>,
) {
  return {
    user: createTestJwtPayload(userId, tenantId, role),
    headers: {
      'x-tenant-id': tenantId,
      ...headers,
    },
    currentTenant: { id: tenantId, role },
    currentUser: createTestJwtPayload(userId, tenantId, role),
  };
}

/**
 * Creates a mock execution context for NestJS guard testing.
 */
export function createMockExecutionContext(
  req: any,
): any {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ status: () => ({ json: () => {} }) }),
    }),
    getHandler: () => () => {},
    getClass: () => class {},
  };
}