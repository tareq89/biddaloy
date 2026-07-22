"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestJwtPayload = createTestJwtPayload;
exports.createMockRequest = createMockRequest;
exports.createMockExecutionContext = createMockExecutionContext;
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
function createTestJwtPayload(userId, tenantId, role, email) {
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
function createMockRequest(tenantId, role, userId = 'test-user-id', headers) {
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
function createMockExecutionContext(req) {
    return {
        switchToHttp: () => ({
            getRequest: () => req,
            getResponse: () => ({ status: () => ({ json: () => { } }) }),
        }),
        getHandler: () => () => { },
        getClass: () => class {
        },
    };
}
//# sourceMappingURL=auth.helper.js.map