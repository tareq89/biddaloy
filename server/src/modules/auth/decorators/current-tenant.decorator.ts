import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Injects the active tenant context `{ id, role }` from the request.
 * Requires ContextGuard to have run first.
 *
 * @example
 * ```typescript
 * @Get('students')
 * async getStudents(@CurrentTenant() tenant: { id: string; role: string }) {
 *   // tenant.id is the active school/tenant ID
 *   // tenant.role is the resolved role
 * }
 * ```
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.currentTenant;
  },
);