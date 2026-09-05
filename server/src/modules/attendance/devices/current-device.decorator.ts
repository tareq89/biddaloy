import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AttendanceDevice } from '../entities/attendance-device.entity';

/**
 * Injects the authenticated device from the request. Requires
 * `DeviceAuthGuard` to have run first — mirrors `CurrentTenant`
 * (`auth/decorators/current-tenant.decorator.ts`) for the JWT path.
 */
export const CurrentDevice = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.currentDevice as AttendanceDevice;
});
