import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Permission, ROLE_PERMISSIONS, roleHasPermission, UserRole } from '@biddaloy/shared';
import { AppModule } from './app.module';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { ROLES_KEY } from './modules/auth/decorators/roles.decorator';
import { PERMISSIONS_KEY } from './modules/auth/decorators/require-permissions.decorator';
import { buildFullPath, RequestMethodName } from './route-guard-coverage.e2e-spec';

/**
 * Regression coverage for [10.3]/[10.4]'s route -> permission mapping (the
 * plan comment on #397's "route -> permission table", resolved by #399).
 * Walks every registered route via DiscoveryService (same machinery as
 * route-guard-coverage), the same way that spec proves the guard stack is
 * present. This spec proves the mapping *declared on* that stack is sound
 * and complete.
 */

const GUARDS_METADATA = '__guards__';
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

interface IdentityScopedEntry {
  controller: string;
  method: string;
  path: string;
  reason: string;
}

/**
 * [10.4] G13, G14 — routes whose authorization is the caller's *identity*
 * (their own JWT `sub`, or a linked guardian row), not a capability check.
 * `ROLE_PERMISSIONS` has nothing to say about "read your own profile" or
 * "list schools you're a super-admin over" — there is no permission that
 * would make sense to grant or withhold here. These are the third valid
 * classification for a `PermissionsGuard` route, alongside "declares
 * `@RequirePermissions`" below.
 */
export const IDENTITY_SCOPED: IdentityScopedEntry[] = [
  {
    controller: 'UserController',
    method: 'GET',
    path: '/users/me',
    reason: '10.4 — self-service: the id comes from the JWT, never the path',
  },
  {
    controller: 'UserController',
    method: 'PATCH',
    path: '/users/me',
    reason: '10.4 — self-service',
  },
  {
    controller: 'UserController',
    method: 'POST',
    path: '/users/me/contact-change',
    reason: '12.7 — self-service: changes the caller own email/phone, id from the JWT',
  },
  {
    controller: 'UserController',
    method: 'POST',
    path: '/users/me/contact-change/confirm-phone',
    reason: '12.7 — self-service',
  },
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/guardians/mine',
    reason: '10.4 — self-service: ownership comes from the JWT, never a path id',
  },
  {
    controller: 'StudentController',
    method: 'PATCH',
    path: '/guardians/mine',
    reason: '10.4 — self-service',
  },
  {
    controller: 'SchoolsController',
    method: 'GET',
    path: '/schools',
    reason: '10.4 — platform route (SUPER_ADMIN school picker), not tenant-scoped',
  },
  {
    controller: 'ProvisioningController',
    method: 'POST',
    path: '/schools',
    reason:
      '15.4.4 — platform route (SUPER_ADMIN provisions a brand-new school), not tenant-scoped; RolesGuard(SUPER_ADMIN) is the whole check.',
  },
  {
    controller: 'SchoolAdminsController',
    method: 'GET',
    path: '/schools/:id/admins',
    reason: '15.4.6 — platform route (SUPER_ADMIN admin recovery), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolAdminsController',
    method: 'POST',
    path: '/schools/:id/admins',
    reason: '15.4.6 — platform route (SUPER_ADMIN admin recovery), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolAdminsController',
    method: 'POST',
    path: '/schools/:id/admins/:userId/resend-invitation',
    reason: '15.4.6 — platform route (SUPER_ADMIN admin recovery), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolAdminsController',
    method: 'DELETE',
    path: '/schools/:id/admins/:userId/invitation',
    reason: '15.4.6 — platform route (SUPER_ADMIN admin recovery), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolsController',
    method: 'GET',
    path: '/schools/:id/stats',
    reason: '15.4.7 — platform route (SUPER_ADMIN school stats), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolsController',
    method: 'PATCH',
    path: '/schools/:id/status',
    reason:
      '15.4.5 — platform route (SUPER_ADMIN suspend/reactivate), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolProfileController',
    method: 'GET',
    path: '/schools/me/profile',
    reason: "15.5.2 — self-service: always the caller's own active tenant, never a path id.",
  },
  {
    controller: 'SchoolProfileController',
    method: 'PATCH',
    path: '/schools/me/profile',
    reason: '15.5.2 — self-service, same as GET /schools/me/profile.',
  },
  {
    controller: 'SchoolLogoController',
    method: 'GET',
    path: '/schools/:id/logo',
    reason:
      '15.5.4 — membership-scoped, not capability-scoped: any staff role that belongs to :id ' +
      '(or SUPER_ADMIN) may read it — see assertCanReadSchoolLogo. No permission would make ' +
      'sense to grant or withhold here.',
  },
  {
    controller: 'SchoolLogoController',
    method: 'POST',
    path: '/schools/me/logo',
    reason: "15.5.3 — self-service upload, always the caller's own active tenant.",
  },
  {
    controller: 'SchoolLogoController',
    method: 'DELETE',
    path: '/schools/me/logo',
    reason: '15.5.3 — self-service removal, same as POST /schools/me/logo.',
  },
  {
    controller: 'SchoolSmsCreditsController',
    method: 'POST',
    path: '/schools/:id/sms-credits',
    reason:
      '15.6.7/#550 — platform route (SUPER_ADMIN SMS credit grant/adjust), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolSmsCreditsController',
    method: 'GET',
    path: '/schools/:id/sms-credits',
    reason:
      '#570 — platform route (SUPER_ADMIN cross-school SMS credit read), same rationale as the POST on this controller.',
  },
  {
    controller: 'PushSubscriptionsController',
    method: 'GET',
    path: '/me/push/public-key',
    reason:
      '15.7 — self-service: whether push is enabled and the VAPID key to subscribe with, no per-user data.',
  },
  {
    controller: 'PushSubscriptionsController',
    method: 'POST',
    path: '/me/push/subscriptions',
    reason:
      "15.7 — self-service: registers the caller's own browser subscription, id from the JWT.",
  },
  {
    controller: 'PushSubscriptionsController',
    method: 'GET',
    path: '/me/push/subscriptions',
    reason: "15.7 — self-service: lists the caller's own subscriptions, id from the JWT.",
  },
  {
    controller: 'PushSubscriptionsController',
    method: 'DELETE',
    path: '/me/push/subscriptions/:id',
    reason:
      "15.7 — self-service: deletes one of the caller's own subscriptions, ownership checked in the service, not the path.",
  },
  {
    controller: 'PushSubscriptionsController',
    method: 'DELETE',
    path: '/me/push/subscriptions',
    reason: "15.7 — self-service: deletes all of the caller's own subscriptions, id from the JWT.",
  },
];

function findIdentityScopedEntry(
  controller: string,
  method: string,
  path: string,
): IdentityScopedEntry | undefined {
  return IDENTITY_SCOPED.find(
    (entry) => entry.controller === controller && entry.method === method && entry.path === path,
  );
}

/**
 * [10.4] D4 — routes where `@Roles` deliberately admits fewer roles than
 * every role holding the required `@RequirePermissions` permission(s) would
 * suggest. Each entry documents *why* the narrowing exists, so the "never
 * tightens" test above stays meaningful: it proves `@Roles` never grants
 * more than the permission map allows, and this proves every place it grants
 * *less* is deliberate, not an oversight.
 */
interface RoleNarrowing {
  controller: string;
  method: string;
  path: string;
  reason: string;
}

export const ROLE_NARROWINGS: RoleNarrowing[] = [
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/students',
    reason:
      'the roster is staff-only, although every role (incl. PARENT/STUDENT) holds STUDENT_READ',
  },
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/students/mine',
    reason: 'family-only — the discovery route for a PARENT/STUDENT is meaningless for staff',
  },
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/guardians',
    reason: 'staff-only directory read, not exposed to PARENT/STUDENT',
  },
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/guardians/:id',
    reason: 'staff-only directory read, not exposed to PARENT/STUDENT',
  },
  {
    controller: 'FeeController',
    method: 'GET',
    path: '/fees/dues/flagged',
    reason: 'staff-only follow-up queue — returns guardian contact details, not exposed to family',
  },
  {
    controller: 'FeeController',
    method: 'GET',
    path: '/payments/guardian/:guardianId',
    reason: "staff-only aggregate read across a guardian's students",
  },
  {
    controller: 'CommunicationsController',
    method: 'POST',
    path: '/communications/send',
    reason: 'staff-only send surface, not exposed to family',
  },
  {
    controller: 'EnrollmentController',
    method: 'GET',
    path: '/enrollments/student/:studentId',
    reason: 'staff-only enrollment-history view; family holds STUDENT_READ but has no such page',
  },
  {
    controller: 'EnrollmentController',
    method: 'GET',
    path: '/enrollments/:studentId/current',
    reason:
      'staff-only "move class" starting point; family holds STUDENT_READ but has no such page',
  },
  {
    controller: 'CommunicationsController',
    method: 'POST',
    path: '/communications/reminder/single/:studentId/preview',
    reason:
      'fee-reminder sending is a front-office action; TEACHER holds COMMUNICATION_SEND for freeform messages only, not reminders',
  },
  {
    controller: 'CommunicationsController',
    method: 'POST',
    path: '/communications/reminder/single/:studentId',
    reason:
      'fee-reminder sending is a front-office action; TEACHER holds COMMUNICATION_SEND for freeform messages only, not reminders',
  },
  {
    controller: 'AttendanceController',
    method: 'GET',
    path: '/attendance/my-sections',
    reason:
      'staff marking landing screen; family holds ATTENDANCE_READ for the read-only family view, not this route',
  },
  {
    controller: 'AttendanceController',
    method: 'GET',
    path: '/attendance/sections/:sectionId/register',
    reason:
      'staff register view; family holds ATTENDANCE_READ for their own child, not the section register',
  },
  {
    controller: 'AttendanceController',
    method: 'GET',
    path: '/attendance/records/:recordId/history',
    reason: 'staff-only correction history for a mark; not exposed on the family attendance view',
  },
  {
    controller: 'AttendanceSummaryController',
    method: 'GET',
    path: '/attendance/sections/:sectionId/summary',
    reason: 'staff-only section summary; family holds ATTENDANCE_READ for their own child only',
  },
  {
    controller: 'AttendanceSummaryController',
    method: 'GET',
    path: '/attendance/sections/:sectionId/register-matrix',
    reason:
      'staff-only section register matrix; family holds ATTENDANCE_READ for their own child only',
  },
  {
    controller: 'AttendanceSummaryController',
    method: 'GET',
    path: '/attendance/flags/low',
    reason:
      'staff-only low-attendance follow-up queue, not TEACHER-visible and not exposed to family',
  },
  {
    controller: 'AbsenceNoticeController',
    method: 'POST',
    path: '/attendance/sections/:sectionId/absence-notice/preview',
    reason:
      'school-policy action kept ADMIN-only; ACCOUNTANT holds COMMUNICATION_BULK_SEND for fee reminders, not this',
  },
  {
    controller: 'AbsenceNoticeController',
    method: 'POST',
    path: '/attendance/sections/:sectionId/absence-notice/send',
    reason:
      'school-policy action kept ADMIN-only; ACCOUNTANT holds COMMUNICATION_BULK_SEND for fee reminders, not this',
  },
];

function findRoleNarrowing(
  controller: string,
  method: string,
  path: string,
): RoleNarrowing | undefined {
  return ROLE_NARROWINGS.find(
    (entry) => entry.controller === controller && entry.method === method && entry.path === path,
  );
}

/**
 * [10.4] D5 — permission values that gate the UI (nav items, dashboard
 * widgets, report buttons) but no server route requires. Nav/page-only
 * gates are legitimate; this list makes which ones exist a deliberate,
 * reviewed choice rather than a silent accumulation.
 */
export const UI_ONLY_PERMISSIONS: Permission[] = [
  // Nav/page gates with no corresponding route check.
  Permission.DASHBOARD_VIEW,
  Permission.DASHBOARD_ADMIN,
  Permission.REPORTS_VIEW,
  Permission.REPORTS_EXPORT,
  // [10.4] G17 — reserved for endpoints that don't exist yet (#291's
  // refund/void work); granted to ADMIN so the value isn't dead weight once
  // that endpoint ships, but nothing consumes it today.
  Permission.INVOICE_DELETE,
  Permission.PAYMENT_REFUND,
  // [10.4] G17 — no route deletes a user account; SUPER_ADMIN-only via
  // Object.values(Permission), never granted to a staff role.
  Permission.USER_DELETE,
  // Pre-existing UI-only gates, unaffected by [10.4]: no route requires
  // these — they gate a button/action inline rather than a whole route
  // (fee-structure management page nav, invoice print button, correcting a
  // mark outside the window, collecting a fee).
  Permission.FEE_STRUCTURE_READ,
  Permission.INVOICE_PRINT,
  Permission.ATTENDANCE_CORRECT,
  Permission.FEE_COLLECT,
];

describe('Permission matrix (regression)', () => {
  let moduleRef: TestingModule;
  let discoveryService: DiscoveryService;
  let metadataScanner: MetadataScanner;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();

    discoveryService = moduleRef.get(DiscoveryService);
    metadataScanner = moduleRef.get(MetadataScanner);
  }, 60000);

  afterAll(async () => {
    await moduleRef.close();
  });

  function walkRoutes(
    visit: (info: {
      controllerName: string;
      methodName: string;
      methodLabel: string;
      fullPath: string;
      roles: UserRole[];
      permissions: Permission[];
    }) => void,
  ) {
    const controllers = discoveryService.getControllers();

    for (const wrapper of controllers) {
      const { metatype } = wrapper;
      if (!metatype) continue;

      const controllerName = metatype.name;
      const controllerPrefix: string = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
      const classRoles: UserRole[] = Reflect.getMetadata(ROLES_KEY, metatype) ?? [];
      const classPermissions: Permission[] = Reflect.getMetadata(PERMISSIONS_KEY, metatype) ?? [];
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, metatype) ?? [];
      const prototype = metatype.prototype;

      for (const methodName of metadataScanner.getAllMethodNames(prototype)) {
        const handler = prototype[methodName];
        const httpMethod: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (httpMethod === undefined) continue;

        const routePath: string = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
        const methodGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
        const allGuards = [...classGuards, ...methodGuards];
        if (!allGuards.includes(PermissionsGuard)) continue;

        // getAllAndOverride semantics: handler metadata wins if present.
        const handlerRoles: UserRole[] | undefined = Reflect.getMetadata(ROLES_KEY, handler);
        const roles = handlerRoles ?? classRoles;
        const handlerPermissions: Permission[] | undefined = Reflect.getMetadata(
          PERMISSIONS_KEY,
          handler,
        );
        const permissions = handlerPermissions ?? classPermissions;

        const fullPath = buildFullPath(controllerPrefix, routePath);
        const methodLabel = RequestMethodName(httpMethod);

        visit({ controllerName, methodName, methodLabel, fullPath, roles, permissions });
      }
    }
  }

  it('never tightens: every role in @Roles (excluding SUPER_ADMIN) holds every @RequirePermissions permission', () => {
    const violations: string[] = [];

    walkRoutes(({ controllerName, methodName, methodLabel, fullPath, roles, permissions }) => {
      if (permissions.length === 0) return;

      for (const role of roles) {
        if (role === UserRole.SUPER_ADMIN) continue;
        for (const permission of permissions) {
          if (!roleHasPermission(role, permission)) {
            violations.push(
              `${methodLabel} ${fullPath} (${controllerName}.${methodName}) — @Roles admits ` +
                `${role}, which lacks required permission ${permission}`,
            );
          }
        }
      }
    });

    expect(violations).toEqual([]);
  });

  it('[10.4] classifies every PermissionsGuard route as APPLY (@RequirePermissions) or IDENTITY_SCOPED', () => {
    const violations: string[] = [];

    walkRoutes(({ controllerName, methodLabel, fullPath, permissions }) => {
      if (permissions.length > 0) return; // APPLY

      const identityScoped = findIdentityScopedEntry(controllerName, methodLabel, fullPath);
      if (!identityScoped) {
        violations.push(
          `${methodLabel} ${fullPath} (${controllerName}) has no @RequirePermissions and no ` +
            'IDENTITY_SCOPED entry — a new route must declare @RequirePermissions() or be added ' +
            'to IDENTITY_SCOPED with a reason',
        );
      }
    });

    expect(violations).toEqual([]);
  });

  it('keeps every IDENTITY_SCOPED entry pointed at a route that still exists', () => {
    const existingRoutes = new Set<string>();

    walkRoutes(({ controllerName, methodLabel, fullPath }) => {
      existingRoutes.add(`${controllerName}|${methodLabel}|${fullPath}`);
    });

    const stale = IDENTITY_SCOPED.filter(
      (entry) => !existingRoutes.has(`${entry.controller}|${entry.method}|${entry.path}`),
    );
    expect(stale).toEqual([]);
  });

  it('[10.4] documents every deliberate @Roles narrowing', () => {
    const violations: string[] = [];
    const allRoles = Object.values(UserRole);

    walkRoutes(({ controllerName, methodLabel, fullPath, roles, permissions }) => {
      if (permissions.length === 0) return; // self-service / platform — not a narrowing question

      const holders = allRoles.filter((role) =>
        permissions.every((permission) => roleHasPermission(role, permission)),
      );
      const roleSet = new Set<UserRole>([...roles, UserRole.SUPER_ADMIN]);
      const holderSet = new Set<UserRole>(holders);

      const sameMembers =
        roleSet.size === holderSet.size && [...roleSet].every((role) => holderSet.has(role));
      if (sameMembers) return;

      const narrowing = findRoleNarrowing(controllerName, methodLabel, fullPath);
      if (!narrowing) {
        violations.push(
          `${methodLabel} ${fullPath} (${controllerName}) — @Roles (${[...roleSet].join(', ')}) ` +
            `differs from every role holding the required permission(s) (${[...holderSet].join(', ')}) ` +
            'and has no ROLE_NARROWINGS entry',
        );
      }
    });

    expect(violations).toEqual([]);
  });

  it('[10.4] lists every UI-only permission', () => {
    const requiredByRoute = new Set<Permission>();
    walkRoutes(({ permissions }) => {
      for (const permission of permissions) requiredByRoute.add(permission);
    });

    const uiOnly = Object.values(Permission).filter(
      (permission) => !requiredByRoute.has(permission),
    );

    expect(new Set(uiOnly)).toEqual(new Set(UI_ONLY_PERMISSIONS));
  });

  it('SUPER_ADMIN holds every permission (sanity check for the narrowing test above)', () => {
    expect(ROLE_PERMISSIONS[UserRole.SUPER_ADMIN]).toEqual(Object.values(Permission));
  });
});
