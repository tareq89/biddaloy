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
    controller: 'PlatformBackupHealthController',
    method: 'GET',
    path: '/platform/backups/health',
    reason:
      '14.12.3/#617 — platform route (SUPER_ADMIN cross-school backup health), same rationale as GET /schools.',
  },
  {
    controller: 'PublicHolidaysController',
    method: 'GET',
    path: '/platform/holiday-sets',
    reason:
      '17.2.4 — platform route (SUPER_ADMIN curates public-holiday sets), no tenant involved.',
  },
  {
    controller: 'PublicHolidaysController',
    method: 'GET',
    path: '/platform/holiday-sets/:id',
    reason:
      '17.2.4 — platform route (SUPER_ADMIN curates public-holiday sets), no tenant involved.',
  },
  {
    controller: 'PublicHolidaysController',
    method: 'POST',
    path: '/platform/holiday-sets/fetch',
    reason:
      '17.2.4 — platform route (SUPER_ADMIN fetches a country/year set from an external source).',
  },
  {
    controller: 'PublicHolidaysController',
    method: 'PUT',
    path: '/platform/holiday-sets/:id/entries',
    reason: '17.2.4 — platform route (SUPER_ADMIN edits set entries).',
  },
  {
    controller: 'PublicHolidaysController',
    method: 'POST',
    path: '/platform/holiday-sets/:id/publish',
    reason: '17.2.4 — platform route (SUPER_ADMIN publishes a set for tenants to import from).',
  },
  {
    controller: 'PublicHolidaysController',
    method: 'POST',
    path: '/platform/holiday-sets/:id/unpublish',
    reason: '17.2.4 — platform route (SUPER_ADMIN unpublishes a set).',
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
    controller: 'RecurringSchedulesController',
    method: 'GET',
    path: '/fees/schedules',
    reason:
      '[16.7.1] recurring schedule definitions are staff-only, although every role (incl. PARENT/STUDENT) holds FEE_READ — a guardian who can read their own fees has no business seeing the billing-automation config',
  },
  {
    controller: 'RecurringSchedulesController',
    method: 'GET',
    path: '/fees/schedules/:id',
    reason: '[16.7.1] same narrowing as GET /fees/schedules',
  },
  {
    controller: 'RecurringSchedulesController',
    method: 'GET',
    path: '/fees/schedules/:id/preview',
    reason: '[16.7.1] same narrowing as GET /fees/schedules',
  },
  {
    controller: 'RecurringSchedulesController',
    method: 'GET',
    path: '/students/:id/schedules',
    reason:
      '[16.8.2] now admits PARENT/STUDENT, who get an allow-listed "what will I be billed ' +
      'next" view (FamilyStudentScheduleDto) after a FamilyAccessService linkage check — never ' +
      'the staff billing-automation config. Still narrower than FEE_READ: TEACHER is excluded, ' +
      'since a teacher has no fee-schedule surface at all',
  },
  {
    controller: 'InvoicesController',
    method: 'POST',
    path: '/invoices/:id/share',
    reason:
      '[#666] minting/listing/revoking a public share link is staff-only, although every role (incl. SUPER_ADMIN/PARENT/STUDENT) holds INVOICE_READ — a guardian who can read their own invoice has no business publishing an unauthenticated link to it',
  },
  {
    controller: 'InvoicesController',
    method: 'GET',
    path: '/invoices/:id/share',
    reason: '[#666] same narrowing as POST /invoices/:id/share',
  },
  {
    controller: 'InvoicesController',
    method: 'DELETE',
    path: '/invoices/:id/share/:tokenId',
    reason: '[#666] same narrowing as POST /invoices/:id/share',
  },
  {
    controller: 'InvoicesController',
    method: 'POST',
    path: '/invoices/:id/send',
    reason:
      '[16.5.4] sending the receipt out (WhatsApp/SMS, spends SMS credit) is staff-only, although every role (incl. SUPER_ADMIN/PARENT/STUDENT) holds INVOICE_READ — a guardian who can read their own invoice has no business sending it to another guardian, same narrowing as POST /invoices/:id/share',
  },
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/students',
    reason:
      'the roster is staff-only, although every role (incl. PARENT/STUDENT) holds STUDENT_READ',
  },
  {
    controller: 'FeeController',
    method: 'POST',
    path: '/fees/schedules/run-now',
    reason:
      '[16.7.2] the manual/ops trigger for the fees-daily sweep is deliberately narrower than SCHEDULE_MANAGE (also held by ACCOUNTANT) — running it is an ops action, not routine fee-collection work',
  },
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/students/ids',
    reason:
      "[16.3.3] the audience picker's select-all is staff-only, although every role (incl. PARENT/STUDENT) holds STUDENT_READ — same narrowing as GET /students",
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
    controller: 'SearchController',
    method: 'GET',
    path: '/search',
    reason:
      '[30.2.1] staff-only palette query across students/guardians/staff/invoices/payments, same rationale as GET /students and GET /guardians — the object-scoped STUDENT_READ/GUARDIAN_READ/INVOICE_READ/PAYMENT_READ permissions PARENT/STUDENT also hold would otherwise let a guardian search every family in the tenant, not just their own.',
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
    controller: 'FeeGenerationsController',
    method: 'GET',
    path: '/fees/generations',
    reason:
      '[16.1.4] staff-only billing-run history — every role holds FEE_READ so a family ' +
      'caller could otherwise see every batch a school has ever run',
  },
  {
    controller: 'FeeGenerationsController',
    method: 'GET',
    path: '/fees/generations/:id',
    reason: '[16.1.4] staff-only billing-run detail, same reason as the list route',
  },
  {
    controller: 'FeeGenerationsController',
    method: 'GET',
    path: '/fees/generations/:id/bills',
    reason: '[16.1.4] staff-only: lists every student billed in a run, across families',
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
  {
    controller: 'MarksController',
    method: 'POST',
    path: '/exams/:examId/marks/reopen',
    reason:
      "[19.4.1] D12 — reopening a SUBMITTED grid is deliberately ADMIN-only, although TEACHER also holds MARK_ENTER (which gates entering/submitting marks). A teacher may submit their own grid but must not be able to unlock it again once it's in review — reopening is enforced a second time inside MarkGridService.reopen with an explicit role check, not just this route gate.",
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
  // [16.2.1] Plumbing landed ahead of the routes that will require them:
  // FEE_APPROVE gates the approval endpoint (16.2.x, not yet built);
  // PAYMENT_REVERSE now gates `POST /payments/:id/reverse` (16.6.1) and
  // REPORT_COLLECTIONS_READ now gates `GET /reports/collections` and
  // `.../collections.csv` (16.6.2), so both are no longer UI-only —
  // removed from this list. [16.7.1]/[16.7.2]/[16.7.3] SCHEDULE_MANAGE now
  // gates the recurring-schedule management endpoints and
  // `POST /fees/schedules/run-now`; DISCOUNT_RULE_MANAGE now gates the
  // discount-rule CRUD endpoints — also removed from this list.
  Permission.FEE_APPROVE,
  // [17.2.1]-[17.2.5] CALENDAR_READ/CALENDAR_MANAGE now gate
  // `/calendar/events`, `/calendar/terms`, `/calendar-settings`, the
  // platform holiday-set routes, and `/calendar/public-holidays/add` —
  // no longer UI-only, removed from this list.
  // [19.1.1] Plumbing landed ahead of the exam/marks/result routes
  // (19.2.1-19.5.1 build the Exam/ExamComponent/marks/result endpoints
  // these will gate). Remove from this list as each route lands.
  // [19.3.1] EXAM_MANAGE now gates every route on ExamsController and
  // ExamComponentsController — no longer UI-only, removed from this list.
  // [19.4.1] MARK_ENTER/MARK_VIEW now gate MarksController's routes —
  // no longer UI-only, removed from this list.
  Permission.RESULT_PROCESS,
  Permission.RESULT_PUBLISH,
  Permission.RESULT_READ,
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

  /**
   * [16.8.1] Epic #637's final role defaults for the fees domain, pinned.
   *
   * The tests above are all *structural* — they prove `@Roles` never grants
   * more than `ROLE_PERMISSIONS` allows, and that every narrowing is
   * documented. None of them pins what `ROLE_PERMISSIONS` actually says, so
   * quietly adding `PAYMENT_REVERSE` to ACCOUNTANT (or `FEE_GENERATE` to
   * TEACHER) would keep the whole suite green.
   *
   * Epic 16 added five money-moving capabilities across seven waves
   * (FEE_GENERATE, PAYMENT_REVERSE, REPORT_COLLECTIONS_READ,
   * SCHEDULE_MANAGE, DISCOUNT_RULE_MANAGE). This test states, per role,
   * exactly which of the fee-domain permissions that role holds when the
   * epic closes. Widening any of them is a one-line diff here, in review.
   */
  describe('[16.8.1] fees-domain role defaults', () => {
    const FEE_DOMAIN: Permission[] = [
      Permission.FEE_READ,
      Permission.FEE_GENERATE,
      Permission.FEE_COLLECT,
      Permission.FEE_APPROVE,
      Permission.FEE_STRUCTURE_CREATE,
      Permission.FEE_STRUCTURE_READ,
      Permission.FEE_STRUCTURE_UPDATE,
      Permission.FEE_STRUCTURE_DELETE,
      Permission.PAYMENT_RECORD,
      Permission.PAYMENT_READ,
      Permission.PAYMENT_REFUND,
      Permission.PAYMENT_REVERSE,
      Permission.INVOICE_CREATE,
      Permission.INVOICE_READ,
      Permission.INVOICE_PRINT,
      Permission.INVOICE_DELETE,
      Permission.REPORT_COLLECTIONS_READ,
      Permission.SCHEDULE_MANAGE,
      Permission.DISCOUNT_RULE_MANAGE,
    ];

    function feeDomainPermissionsOf(role: UserRole): Permission[] {
      return FEE_DOMAIN.filter((permission) => roleHasPermission(role, permission)).sort();
    }

    function expectFeeDomain(role: UserRole, expected: Permission[]): void {
      expect(feeDomainPermissionsOf(role)).toEqual([...expected].sort());
    }

    it('ADMIN holds every fees-domain permission', () => {
      expectFeeDomain(UserRole.ADMIN, FEE_DOMAIN);
    });

    it('ACCOUNTANT runs collection but cannot approve or reverse', () => {
      expectFeeDomain(UserRole.ACCOUNTANT, [
        Permission.FEE_READ,
        Permission.FEE_GENERATE,
        Permission.FEE_COLLECT,
        Permission.FEE_STRUCTURE_CREATE,
        Permission.FEE_STRUCTURE_READ,
        Permission.FEE_STRUCTURE_UPDATE,
        Permission.PAYMENT_RECORD,
        Permission.PAYMENT_READ,
        Permission.INVOICE_CREATE,
        Permission.INVOICE_READ,
        Permission.INVOICE_PRINT,
        Permission.REPORT_COLLECTIONS_READ,
        Permission.SCHEDULE_MANAGE,
        Permission.DISCOUNT_RULE_MANAGE,
      ]);
    });

    it('ACCOUNTANT specifically holds neither FEE_APPROVE nor PAYMENT_REVERSE', () => {
      // [16.2.1] kept both ADMIN-only regardless of the tenant's
      // approval_mode: an approver must not be able to approve their own
      // work, and a reversal undoes money that already moved. `POST
      // /payments/:id/reverse` is `@Roles(ADMIN)` to match, and
      // `checkout.controller.e2e-spec.ts` pins the 401 for an ACCOUNTANT.
      // Granting either here silently widens who can unwind a payment.
      expect(roleHasPermission(UserRole.ACCOUNTANT, Permission.FEE_APPROVE)).toBe(false);
      expect(roleHasPermission(UserRole.ACCOUNTANT, Permission.PAYMENT_REVERSE)).toBe(false);
      expect(roleHasPermission(UserRole.ADMIN, Permission.PAYMENT_REVERSE)).toBe(true);
    });

    it('EXECUTIVE is read-only: fee reads plus the collections report, nothing that writes', () => {
      expectFeeDomain(UserRole.EXECUTIVE, [
        Permission.FEE_READ,
        Permission.REPORT_COLLECTIONS_READ,
      ]);
    });

    it('TEACHER holds only the object-scoped fee read, never a money capability', () => {
      // FEE_READ is object-scoped for a TEACHER exactly as it is for a
      // family: the routes it unlocks (`/fees/dues`, `/fee-structures`)
      // decide *whose* fees, not this permission.
      expectFeeDomain(UserRole.TEACHER, [Permission.FEE_READ]);
    });

    it('PARENT and STUDENT hold only the two object-scoped family reads', () => {
      for (const role of [UserRole.PARENT, UserRole.STUDENT]) {
        expectFeeDomain(role, [Permission.FEE_READ, Permission.INVOICE_READ]);
      }
    });

    it('no non-admin role holds a fees capability that moves or unwinds money', () => {
      const moneyMoving = [
        Permission.FEE_APPROVE,
        Permission.PAYMENT_REVERSE,
        Permission.PAYMENT_REFUND,
        Permission.INVOICE_DELETE,
      ];
      const nonAdmin = [
        UserRole.ACCOUNTANT,
        UserRole.EXECUTIVE,
        UserRole.TEACHER,
        UserRole.PARENT,
        UserRole.STUDENT,
      ];

      const violations: string[] = [];
      for (const role of nonAdmin) {
        for (const permission of moneyMoving) {
          if (roleHasPermission(role, permission)) {
            violations.push(`${role} holds ${permission}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });
});
