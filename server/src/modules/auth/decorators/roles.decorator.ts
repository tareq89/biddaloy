import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Decorator that specifies which roles are allowed to access a route.
 * Used in conjunction with ContextGuard and RolesGuard.
 *
 * @example
 * ```typescript
 * @UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
 * @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
 * ```
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);