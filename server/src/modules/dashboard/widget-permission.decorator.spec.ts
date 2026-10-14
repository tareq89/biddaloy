import { describe, it, expect } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DashboardWidgetKey, Permission, UserRole } from '@biddaloy/shared';
import { PERMISSIONS_KEY } from '../auth/decorators/require-permissions.decorator';
import {
  DASHBOARD_WIDGET_KEY,
  DashboardWidgetRoleGuard,
  DashboardWidgetRoute,
} from './widget-permission.decorator';

class Probe {
  @DashboardWidgetRoute(DashboardWidgetKey.STAFF_TODAY)
  staff() {}
}

function ctx(role?: UserRole) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ currentTenant: role && { id: 't', role } }) }),
    getHandler: () => Probe.prototype.staff,
    getClass: () => Probe,
  } as never;
}

describe('DashboardWidgetRoleGuard', () => {
  const guard = new DashboardWidgetRoleGuard(new Reflector());

  it('allows a role in the catalogue', () => {
    expect(guard.canActivate(ctx(UserRole.ADMIN))).toBe(true);
  });

  it.each([UserRole.TEACHER, UserRole.SUPER_ADMIN])('403 DASHBOARD_WIDGET_ROLE for %s', (role) => {
    try {
      guard.canActivate(ctx(role));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toMatchObject({
        details: { code: 'DASHBOARD_WIDGET_ROLE' },
      });
    }
  });

  it('401 without a tenant context', () => {
    expect(() => guard.canActivate(ctx())).toThrow(UnauthorizedException);
  });

  it('decorator sets permissions, key, guard and path', () => {
    const h = Probe.prototype.staff;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h)).toEqual([
      Permission.DASHBOARD_VIEW,
      Permission.STAFF_ATTENDANCE_READ,
    ]);
    expect(Reflect.getMetadata(DASHBOARD_WIDGET_KEY, h)).toBe('staff-today');
    expect(Reflect.getMetadata('__guards__', h)).toContain(DashboardWidgetRoleGuard);
    expect(Reflect.getMetadata('path', h)).toBe('dashboard/widgets/staff-today');
  });
});
