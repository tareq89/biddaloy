import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiUnauthorizedResponse } from '@nestjs/swagger';

/**
 * Documents the auth contract every ContextGuard-protected controller
 * shares — bearer JWT, required X-Tenant-ID, optional X-Role — matching
 * the actual guard behavior in context.guard.ts. Apply at the controller
 * level alongside @UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard).
 */
export function ApiTenantAuth() {
  return applyDecorators(
    ApiBearerAuth('bearer'),
    ApiHeader({
      name: 'X-Tenant-ID',
      required: true,
      description: "Active tenant's school ID — validated against the caller's memberships by ContextGuard.",
    }),
    ApiHeader({
      name: 'X-Role',
      required: false,
      description:
        'Explicit role to act as, for a caller with more than one membership. Defaults to the first membership found when omitted.',
    }),
    ApiUnauthorizedResponse({ description: 'Missing/invalid bearer token, or missing/invalid X-Tenant-ID.' }),
  );
}
