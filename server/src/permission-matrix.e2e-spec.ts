import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Permission, roleHasPermission, UserRole } from '@biddaloy/shared';
import { AppModule } from './app.module';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { ROLES_KEY } from './modules/auth/decorators/roles.decorator';
import { PERMISSIONS_KEY } from './modules/auth/decorators/require-permissions.decorator';
import { buildFullPath, RequestMethodName } from './route-guard-coverage.e2e-spec';

/**
 * Regression coverage for [10.3]'s route -> permission mapping (the plan
 * comment on #397's "route -> permission table"). Walks every registered
 * route via DiscoveryService (same machinery as route-guard-coverage), the
 * same way that spec proves the guard stack is present. This spec proves
 * the mapping *declared on* that stack is sound and complete.
 */

const GUARDS_METADATA = '__guards__';
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

interface PendingEntry {
  controller: string;
  method: string;
  path: string;
  candidate: Permission | null;
  drift: UserRole[];
  reason: string;
}

/**
 * One entry per PENDING/NO-MATCH row in the [10.3] plan's route table.
 * 10.4 resolves these; until then each stays a documented, reviewed gap
 * rather than a silent one. Nothing in [10.3] removes an entry from this
 * list — the third test below only checks that every entry still points at
 * a real route.
 */
export const PENDING_PERMISSION_DECISION: PendingEntry[] = [
  // academic-year.controller.ts
  {
    controller: 'AcademicYearController',
    method: 'POST',
    path: '/academic-years',
    candidate: Permission.ACADEMIC_YEAR_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack ACADEMIC_YEAR_MANAGE',
  },
  {
    controller: 'AcademicYearController',
    method: 'GET',
    path: '/academic-years',
    candidate: null,
    drift: [],
    reason: '10.4 — no read permission for academic structure',
  },
  {
    controller: 'AcademicYearController',
    method: 'GET',
    path: '/academic-years/:id',
    candidate: null,
    drift: [],
    reason: '10.4 — no read permission for academic structure',
  },
  {
    controller: 'AcademicYearController',
    method: 'GET',
    path: '/academic-years/:id/stats',
    candidate: null,
    drift: [],
    reason: '10.4 — no read permission for academic structure',
  },
  {
    controller: 'AcademicYearController',
    method: 'PATCH',
    path: '/academic-years/:id',
    candidate: Permission.ACADEMIC_YEAR_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack ACADEMIC_YEAR_MANAGE',
  },
  {
    controller: 'AcademicYearController',
    method: 'DELETE',
    path: '/academic-years/:id',
    candidate: Permission.ACADEMIC_YEAR_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack ACADEMIC_YEAR_MANAGE',
  },
  {
    controller: 'AcademicYearController',
    method: 'POST',
    path: '/academic-years/:id/set-current',
    candidate: Permission.ACADEMIC_YEAR_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack ACADEMIC_YEAR_MANAGE',
  },
  // school-calendar.controller.ts
  {
    controller: 'SchoolCalendarController',
    method: 'GET',
    path: '/school-calendar/holidays',
    candidate: null,
    drift: [],
    reason: '10.4 — no read permission for academic structure',
  },
  {
    controller: 'SchoolCalendarController',
    method: 'POST',
    path: '/school-calendar/holidays',
    candidate: Permission.ACADEMIC_YEAR_MANAGE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks ACADEMIC_YEAR_MANAGE',
  },
  {
    controller: 'SchoolCalendarController',
    method: 'PATCH',
    path: '/school-calendar/holidays/:id',
    candidate: Permission.ACADEMIC_YEAR_MANAGE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks ACADEMIC_YEAR_MANAGE',
  },
  {
    controller: 'SchoolCalendarController',
    method: 'DELETE',
    path: '/school-calendar/holidays/:id',
    candidate: Permission.ACADEMIC_YEAR_MANAGE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks ACADEMIC_YEAR_MANAGE',
  },
  {
    controller: 'SchoolCalendarController',
    method: 'GET',
    path: '/school-calendar/working-days',
    candidate: null,
    drift: [],
    reason: '10.4 — no read permission for academic structure',
  },
  // subjects.controller.ts (SubjectController)
  {
    controller: 'SubjectController',
    method: 'POST',
    path: '/subjects',
    candidate: Permission.CLASS_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack CLASS_MANAGE',
  },
  {
    controller: 'SubjectController',
    method: 'GET',
    path: '/subjects',
    candidate: null,
    drift: [],
    reason: '10.4 — no read permission for academic structure',
  },
  {
    controller: 'SubjectController',
    method: 'GET',
    path: '/subjects/:id',
    candidate: null,
    drift: [],
    reason: '10.4 — no read permission for academic structure',
  },
  {
    controller: 'SubjectController',
    method: 'PATCH',
    path: '/subjects/:id',
    candidate: Permission.CLASS_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack CLASS_MANAGE',
  },
  {
    controller: 'SubjectController',
    method: 'DELETE',
    path: '/subjects/:id',
    candidate: Permission.CLASS_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack CLASS_MANAGE',
  },
  // subjects.controller.ts (ClassSubjectController — second @Controller('classes') class)
  {
    controller: 'ClassSubjectController',
    method: 'GET',
    path: '/classes/:classId/subjects',
    candidate: null,
    drift: [],
    reason: '10.4 — no read permission for academic structure',
  },
  {
    controller: 'ClassSubjectController',
    method: 'POST',
    path: '/classes/:classId/subjects',
    candidate: Permission.CLASS_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack CLASS_MANAGE',
  },
  {
    controller: 'ClassSubjectController',
    method: 'DELETE',
    path: '/classes/:classId/subjects/:subjectId',
    candidate: Permission.CLASS_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack CLASS_MANAGE',
  },
  // absence-notice.controller.ts
  {
    controller: 'AbsenceNoticeController',
    method: 'POST',
    path: '/attendance/sections/:sectionId/absence-notice/preview',
    candidate: Permission.COMMUNICATION_BULK_SEND,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks COMMUNICATION_BULK_SEND',
  },
  {
    controller: 'AbsenceNoticeController',
    method: 'POST',
    path: '/attendance/sections/:sectionId/absence-notice/send',
    candidate: Permission.COMMUNICATION_BULK_SEND,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks COMMUNICATION_BULK_SEND',
  },
  // attendance.controller.ts
  {
    controller: 'AttendanceController',
    method: 'PUT',
    path: '/attendance/sections/:sectionId/register',
    candidate: Permission.ATTENDANCE_MARK,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks ATTENDANCE_MARK',
  },
  {
    controller: 'AttendanceController',
    method: 'POST',
    path: '/attendance/sections/:sectionId/register/finalize',
    candidate: Permission.ATTENDANCE_MARK,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks ATTENDANCE_MARK',
  },
  {
    controller: 'AttendanceController',
    method: 'PATCH',
    path: '/attendance/records/:recordId',
    candidate: Permission.ATTENDANCE_MARK,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks ATTENDANCE_MARK',
  },
  // devices.controller.ts
  {
    controller: 'DevicesController',
    method: 'POST',
    path: '/attendance/devices',
    candidate: Permission.ATTENDANCE_DEVICE_MANAGE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks ATTENDANCE_DEVICE_MANAGE',
  },
  {
    controller: 'DevicesController',
    method: 'GET',
    path: '/attendance/devices',
    candidate: Permission.ATTENDANCE_DEVICE_MANAGE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks ATTENDANCE_DEVICE_MANAGE',
  },
  {
    controller: 'DevicesController',
    method: 'POST',
    path: '/attendance/devices/:id/rotate',
    candidate: Permission.ATTENDANCE_DEVICE_MANAGE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks ATTENDANCE_DEVICE_MANAGE',
  },
  {
    controller: 'DevicesController',
    method: 'DELETE',
    path: '/attendance/devices/:id',
    candidate: Permission.ATTENDANCE_DEVICE_MANAGE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks ATTENDANCE_DEVICE_MANAGE',
  },
  // audit.controller.ts
  {
    controller: 'AuditController',
    method: 'GET',
    path: '/audit-logs/entity/:entityType/:entityId',
    candidate: Permission.AUDIT_LOG_READ,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER],
    reason: '10.4 — AC, E, T lack AUDIT_LOG_READ',
  },
  // classes.controller.ts
  {
    controller: 'ClassController',
    method: 'POST',
    path: '/classes',
    candidate: Permission.CLASS_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack CLASS_MANAGE',
  },
  {
    controller: 'ClassController',
    method: 'GET',
    path: '/classes',
    candidate: null,
    drift: [],
    reason: '10.4 — no read permission for academic structure',
  },
  {
    controller: 'ClassController',
    method: 'GET',
    path: '/classes/:id',
    candidate: null,
    drift: [],
    reason: '10.4 — no read permission for academic structure',
  },
  {
    controller: 'ClassController',
    method: 'PATCH',
    path: '/classes/:id',
    candidate: Permission.CLASS_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack CLASS_MANAGE',
  },
  {
    controller: 'ClassController',
    method: 'DELETE',
    path: '/classes/:id',
    candidate: Permission.CLASS_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack CLASS_MANAGE',
  },
  {
    controller: 'ClassController',
    method: 'POST',
    path: '/classes/:classId/sections',
    candidate: Permission.CLASS_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack CLASS_MANAGE',
  },
  {
    controller: 'ClassController',
    method: 'GET',
    path: '/classes/:classId/sections',
    candidate: null,
    drift: [],
    reason: '10.4 — no read permission for academic structure',
  },
  {
    controller: 'ClassController',
    method: 'PATCH',
    path: '/classes/:classId/sections/:sectionId',
    candidate: Permission.CLASS_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack CLASS_MANAGE',
  },
  {
    controller: 'ClassController',
    method: 'DELETE',
    path: '/classes/:classId/sections/:sectionId',
    candidate: Permission.CLASS_MANAGE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack CLASS_MANAGE',
  },
  {
    controller: 'ClassController',
    method: 'GET',
    path: '/classes/:classId/teachers',
    candidate: null,
    drift: [],
    reason: '10.4 — no read permission for academic structure',
  },
  // communications.controller.ts
  {
    controller: 'CommunicationsController',
    method: 'POST',
    path: '/communications/reminder/single/:studentId/preview',
    candidate: Permission.COMMUNICATION_SEND,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks COMMUNICATION_SEND',
  },
  {
    controller: 'CommunicationsController',
    method: 'POST',
    path: '/communications/reminder/single/:studentId',
    candidate: Permission.COMMUNICATION_SEND,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks COMMUNICATION_SEND',
  },
  {
    controller: 'CommunicationsController',
    method: 'POST',
    path: '/communications/reminder/bulk/preview',
    candidate: Permission.COMMUNICATION_BULK_SEND,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks COMMUNICATION_BULK_SEND',
  },
  {
    controller: 'CommunicationsController',
    method: 'POST',
    path: '/communications/reminder/bulk',
    candidate: Permission.COMMUNICATION_BULK_SEND,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks COMMUNICATION_BULK_SEND',
  },
  {
    controller: 'CommunicationsController',
    method: 'GET',
    path: '/communications/reminder/bulk',
    candidate: Permission.COMMUNICATION_BULK_SEND,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks COMMUNICATION_BULK_SEND',
  },
  {
    controller: 'CommunicationsController',
    method: 'GET',
    path: '/communications/reminder/bulk/:id/logs',
    candidate: Permission.COMMUNICATION_BULK_SEND,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks COMMUNICATION_BULK_SEND',
  },
  {
    controller: 'CommunicationsController',
    method: 'GET',
    path: '/communications/reminder/bulk/:id',
    candidate: Permission.COMMUNICATION_BULK_SEND,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks COMMUNICATION_BULK_SEND',
  },
  {
    controller: 'CommunicationsController',
    method: 'POST',
    path: '/communications/send',
    candidate: Permission.COMMUNICATION_SEND,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks COMMUNICATION_SEND',
  },
  {
    controller: 'CommunicationsController',
    method: 'GET',
    path: '/communications/last-reminders',
    candidate: Permission.COMMUNICATION_LOG_READ,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER],
    reason: '10.4 — AC, E, T lack COMMUNICATION_LOG_READ',
  },
  {
    controller: 'CommunicationsController',
    method: 'GET',
    path: '/communications/student/:studentId',
    candidate: Permission.COMMUNICATION_LOG_READ,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER],
    reason: '10.4 — AC, E, T lack COMMUNICATION_LOG_READ',
  },
  {
    controller: 'CommunicationsController',
    method: 'GET',
    path: '/communications/guardian/:guardianId',
    candidate: Permission.COMMUNICATION_LOG_READ,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER],
    reason: '10.4 — AC, E, T lack COMMUNICATION_LOG_READ',
  },
  {
    controller: 'CommunicationsController',
    method: 'GET',
    path: '/communications/:id',
    candidate: Permission.COMMUNICATION_LOG_READ,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER],
    reason: '10.4 — AC, E, T lack COMMUNICATION_LOG_READ',
  },
  // enrollments.controller.ts
  {
    controller: 'EnrollmentController',
    method: 'POST',
    path: '/enrollments',
    candidate: Permission.STUDENT_UPDATE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack STUDENT_UPDATE',
  },
  {
    controller: 'EnrollmentController',
    method: 'PATCH',
    path: '/enrollments/:id',
    candidate: Permission.STUDENT_UPDATE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack STUDENT_UPDATE',
  },
  // fees.controller.ts / fee-structures / payments / invoices
  {
    controller: 'FeeController',
    method: 'POST',
    path: '/fee-structures',
    candidate: Permission.FEE_STRUCTURE_CREATE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks FEE_STRUCTURE_CREATE',
  },
  {
    controller: 'FeeController',
    method: 'GET',
    path: '/fee-structures',
    candidate: Permission.FEE_STRUCTURE_READ,
    drift: [UserRole.EXECUTIVE, UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT],
    reason: '10.4 — E, T, P, S lack FEE_STRUCTURE_READ',
  },
  {
    controller: 'FeeController',
    method: 'GET',
    path: '/fee-structures/:id',
    candidate: Permission.FEE_STRUCTURE_READ,
    drift: [UserRole.EXECUTIVE, UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT],
    reason: '10.4 — E, T, P, S lack FEE_STRUCTURE_READ',
  },
  {
    controller: 'FeeController',
    method: 'PATCH',
    path: '/fee-structures/:id',
    candidate: Permission.FEE_STRUCTURE_UPDATE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks FEE_STRUCTURE_UPDATE',
  },
  {
    controller: 'FeeController',
    method: 'POST',
    path: '/payments',
    candidate: Permission.PAYMENT_RECORD,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks PAYMENT_RECORD',
  },
  {
    controller: 'FeeController',
    method: 'POST',
    path: '/payments/record-with-allocation',
    candidate: Permission.PAYMENT_RECORD,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks PAYMENT_RECORD',
  },
  {
    controller: 'FeeController',
    method: 'GET',
    path: '/payments/invoices/student/:studentId',
    candidate: Permission.INVOICE_READ,
    drift: [UserRole.EXECUTIVE, UserRole.TEACHER],
    reason: '10.4 — E, T lack INVOICE_READ',
  },
  // invoices.controller.ts
  {
    controller: 'InvoicesController',
    method: 'POST',
    path: '/invoices',
    candidate: Permission.INVOICE_CREATE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks INVOICE_CREATE',
  },
  {
    controller: 'InvoicesController',
    method: 'GET',
    path: '/invoices',
    candidate: Permission.INVOICE_READ,
    drift: [UserRole.EXECUTIVE, UserRole.TEACHER],
    reason: '10.4 — E, T lack INVOICE_READ',
  },
  {
    controller: 'InvoicesController',
    method: 'GET',
    path: '/invoices/:id',
    candidate: Permission.INVOICE_READ,
    drift: [UserRole.EXECUTIVE, UserRole.TEACHER],
    reason: '10.4 — E, T lack INVOICE_READ',
  },
  {
    controller: 'InvoicesController',
    method: 'GET',
    path: '/invoices/:id/print',
    candidate: Permission.INVOICE_PRINT,
    drift: [UserRole.EXECUTIVE, UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT],
    reason: '10.4 — E, T, P, S lack INVOICE_PRINT',
  },
  // schools.controller.ts
  {
    controller: 'SchoolsController',
    method: 'GET',
    path: '/schools',
    candidate: null,
    drift: [],
    reason: '10.4 — platform route, not tenant-scoped',
  },
  // students.controller.ts
  {
    controller: 'StudentController',
    method: 'POST',
    path: '/students',
    candidate: Permission.STUDENT_CREATE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack STUDENT_CREATE',
  },
  {
    controller: 'StudentController',
    method: 'PATCH',
    path: '/students/:id',
    candidate: Permission.STUDENT_UPDATE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack STUDENT_UPDATE',
  },
  {
    controller: 'StudentController',
    method: 'POST',
    path: '/guardians',
    candidate: Permission.GUARDIAN_CREATE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack GUARDIAN_CREATE',
  },
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/guardians',
    candidate: Permission.GUARDIAN_READ,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks GUARDIAN_READ',
  },
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/guardians/mine',
    candidate: null,
    drift: [],
    reason: '10.4 — self-service: identity, not permission',
  },
  {
    controller: 'StudentController',
    method: 'PATCH',
    path: '/guardians/mine',
    candidate: null,
    drift: [],
    reason: '10.4 — self-service',
  },
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/guardians/:id',
    candidate: Permission.GUARDIAN_READ,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks GUARDIAN_READ',
  },
  {
    controller: 'StudentController',
    method: 'PATCH',
    path: '/guardians/:id',
    candidate: Permission.GUARDIAN_UPDATE,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE],
    reason: '10.4 — AC, E lack GUARDIAN_UPDATE',
  },
  {
    controller: 'StudentController',
    method: 'DELETE',
    path: '/guardians/:id',
    candidate: null,
    drift: [],
    reason: '10.4 — no GUARDIAN_DELETE value',
  },
  // users.controller.ts
  {
    controller: 'UserController',
    method: 'POST',
    path: '/users',
    candidate: Permission.USER_CREATE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks USER_CREATE',
  },
  {
    controller: 'UserController',
    method: 'POST',
    path: '/users/:id/invitation/resend',
    candidate: Permission.USER_CREATE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks USER_CREATE',
  },
  {
    controller: 'UserController',
    method: 'DELETE',
    path: '/users/:id/invitation',
    candidate: Permission.USER_CREATE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks USER_CREATE',
  },
  {
    controller: 'UserController',
    method: 'GET',
    path: '/users',
    candidate: Permission.USER_READ,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER],
    reason: '10.4 — AC, E, T lack USER_READ',
  },
  {
    controller: 'UserController',
    method: 'GET',
    path: '/users/me',
    candidate: null,
    drift: [],
    reason: '10.4 — self-service',
  },
  {
    controller: 'UserController',
    method: 'PATCH',
    path: '/users/me',
    candidate: null,
    drift: [],
    reason: '10.4 — self-service',
  },
  {
    controller: 'UserController',
    method: 'GET',
    path: '/users/:id',
    candidate: Permission.USER_READ,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER],
    reason: '10.4 — AC, E, T lack USER_READ',
  },
  {
    controller: 'UserController',
    method: 'PATCH',
    path: '/users/:id',
    candidate: Permission.USER_UPDATE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks USER_UPDATE',
  },
  {
    controller: 'UserController',
    method: 'POST',
    path: '/teachers',
    candidate: Permission.USER_CREATE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks USER_CREATE',
  },
  {
    controller: 'UserController',
    method: 'GET',
    path: '/teachers',
    candidate: Permission.USER_READ,
    drift: [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER],
    reason: '10.4 — AC, E, T lack USER_READ',
  },
  {
    controller: 'UserController',
    method: 'PATCH',
    path: '/teachers/:id',
    candidate: Permission.USER_UPDATE,
    drift: [UserRole.EXECUTIVE],
    reason: '10.4 — E lacks USER_UPDATE',
  },
];

function findPendingEntry(
  controller: string,
  method: string,
  path: string,
): PendingEntry | undefined {
  return PENDING_PERMISSION_DECISION.find(
    (entry) => entry.controller === controller && entry.method === method && entry.path === path,
  );
}

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

  it('classifies every PermissionsGuard route as either APPLY or PENDING_PERMISSION_DECISION', () => {
    const violations: string[] = [];

    walkRoutes(({ controllerName, methodLabel, fullPath, permissions }) => {
      if (permissions.length > 0) return; // APPLY

      const pending = findPendingEntry(controllerName, methodLabel, fullPath);
      if (!pending) {
        violations.push(
          `${methodLabel} ${fullPath} (${controllerName}) has no @RequirePermissions and no ` +
            'PENDING_PERMISSION_DECISION entry — classify it as one or the other',
        );
      }
    });

    expect(violations).toEqual([]);
  });

  it('keeps every PENDING_PERMISSION_DECISION entry pointed at a route that still exists', () => {
    const existingRoutes = new Set<string>();

    walkRoutes(({ controllerName, methodLabel, fullPath }) => {
      existingRoutes.add(`${controllerName}|${methodLabel}|${fullPath}`);
    });

    const stale = PENDING_PERMISSION_DECISION.filter(
      (entry) => !existingRoutes.has(`${entry.controller}|${entry.method}|${entry.path}`),
    );
    expect(stale).toEqual([]);
  });
});
