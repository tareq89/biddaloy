import { SetMetadata } from '@nestjs/common';

export const AUTHENTICATED_ONLY_KEY = 'authenticatedOnly';

/**
 * The route is authorised by the caller's identity (own data, or a guard like
 * PlatformSuperAdminGuard), not by a ROLE_PERMISSIONS capability. Every use
 * must have a matching IDENTITY_SCOPED entry in permission-matrix.e2e-spec.ts.
 */
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY_KEY, true);
