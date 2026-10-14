import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiForbiddenResponse, ApiOperation } from '@nestjs/swagger';
import { DashboardWidgetKey, Permission, WIDGET_CATALOGUE } from '@biddaloy/shared';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';

export const DASHBOARD_WIDGET_KEY = 'dashboardWidget';

/**
 * D46: the caller's active role must be in the catalogue's `roles`, even if it
 * holds the permissions. Runs after the class guards, so `currentTenant` is set
 * and a missing permission has already produced the usual permission 403.
 */
@Injectable()
export class DashboardWidgetRoleGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const key = this.reflector.get<DashboardWidgetKey>(DASHBOARD_WIDGET_KEY, context.getHandler());
    const { currentTenant } = context.switchToHttp().getRequest();
    if (!currentTenant) throw new UnauthorizedException('No active tenant context');
    if (!WIDGET_CATALOGUE[key].roles.includes(currentTenant.role)) {
      throw new ForbiddenException({
        message: `Widget ${key} is not available to ${currentTenant.role}`,
        details: { code: 'DASHBOARD_WIDGET_ROLE' },
      });
    }
    return true;
  }
}

/**
 * One widget route (D28): GET /dashboard/widgets/<key>, gated on DASHBOARD_VIEW
 * plus the catalogue's permissions for that key. Use on a controller declared
 * `@Controller()` with
 * `@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)` and
 * `@ApiTenantAuth()`. Add `@ApiOkResponse({ type: <WidgetDto> })` beside it.
 */
export function DashboardWidgetRoute(key: DashboardWidgetKey) {
  return applyDecorators(
    Get(`dashboard/widgets/${key}`),
    RequirePermissions(Permission.DASHBOARD_VIEW, ...WIDGET_CATALOGUE[key].permissions),
    SetMetadata(DASHBOARD_WIDGET_KEY, key),
    UseGuards(DashboardWidgetRoleGuard),
    ApiOperation({ summary: `Dashboard widget: ${key}` }),
    ApiForbiddenResponse({
      description: 'Missing permission, or role not offered this widget (DASHBOARD_WIDGET_ROLE)',
    }),
  );
}
