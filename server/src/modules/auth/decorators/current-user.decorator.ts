import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '@beton-boi/shared';

/**
 * Injects the full JWT payload (user info + memberships) from the request.
 * Requires AuthGuard('jwt') to have run first.
 *
 * @example
 * ```typescript
 * @Get('profile')
 * async getProfile(@CurrentUser() user: JwtPayload) {
 *   // user.sub = user ID
 *   // user.memberships = all tenant memberships
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);