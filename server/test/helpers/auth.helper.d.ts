import { JwtPayload, JwtMembership, UserRole } from "@beton-boi/shared";
/**
 * Auth Helper for Tests
 *
 * Provides utilities to generate JWT tokens for test users
 * without needing to hit the real login endpoint.
 */
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
export declare function createTestJwtPayload(userId: string, tenantId: string, role: UserRole, email?: string): JwtPayload;
/**
 * Creates a mock request object with the given tenant context.
 * Useful for testing guards in isolation.
 */
export declare function createMockRequest(tenantId: string, role: UserRole, userId?: string, headers?: Record<string, string>): {
    user: JwtPayload;
    headers: {
        'x-tenant-id': string;
    };
    currentTenant: {
        id: string;
        role: UserRole;
    };
    currentUser: JwtPayload;
};
/**
 * Creates a mock execution context for NestJS guard testing.
 */
export declare function createMockExecutionContext(req: any): any;
//# sourceMappingURL=auth.helper.d.ts.map