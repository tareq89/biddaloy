import { CORE_AREAS, ModuleKey } from '@biddaloy/shared';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { ACTIONS } from './action-registry';
import {
  STAFF_NAV_GROUPS,
  STAFF_NAV_ITEMS,
  STAFF_TOP_NAV_ITEMS,
  type StaffNavItemDef,
} from './nav-tree';
import { routeModule, STAFF_ROUTE_PERMISSIONS } from './route-permissions';
import { routeTree } from './routeTree.gen';

/**
 * [77.3.1] Epic 77 drift guard (D47): every nav item, route and palette action
 * either belongs to a switchable module (`module` / `routeModule`) or is named
 * here as core, with the CORE_AREAS area that makes it never-off (D6, D46).
 * A new item with neither fails here instead of silently never hiding.
 */
type CoreArea = (typeof CORE_AREAS)[number];

const CORE_NAV: Record<string, CoreArea> = {
  dashboard: 'dashboard',
  'people.students': 'students',
  'people.guardians': 'guardians',
  'people.calendar': 'calendar',
  'people.staff': 'staff',
  'people.staffImport': 'staff',
  'people.teachingAssignments': 'teachingAssignments',
  'academics.academicYears': 'academicYears',
  'academics.classes': 'classes',
  'academics.myClass': 'classes',
  'academics.myCoordination': 'classes',
  'reports.hub': 'reports',
  'reports.studentCount': 'reports',
  'reports.alertsReport': 'reports',
  'reports.printables': 'documents',
  'communications.sendAlert': 'dashboard',
  'administration.printTemplates': 'documents',
  'administration.roles': 'roles',
  'administration.auditLogs': 'auditLogs',
  'administration.settings': 'settings',
  'administration.curriculumPreset': 'settings',
};

/** Route's first segment under `/_staff/` -> core area. */
const CORE_ROUTE_SEGMENT: Record<string, CoreArea> = {
  dashboard: 'dashboard',
  notifications: 'dashboard',
  security: 'settings',
  welcome: 'settings',
  students: 'students',
  guardians: 'guardians',
  calendar: 'calendar',
  staff: 'staff',
  'academic-years': 'academicYears',
  classes: 'classes',
  'my-class': 'classes',
  'my-coordination': 'classes',
  reports: 'reports',
  print: 'documents',
  'print-templates': 'documents',
  roles: 'roles',
  'audit-logs': 'auditLogs',
  settings: 'settings',
  'support-access': 'settings',
  'curriculum-preset': 'settings',
  communications: 'dashboard', // send-alert only; the rest carries a module
};

/** Palette action id prefix (before the first dot) -> core area. */
const CORE_ACTION_PREFIX: Record<string, CoreArea> = {
  help: 'dashboard',
  dashboard: 'dashboard',
  attention: 'dashboard',
  onboarding: 'settings',
  account: 'settings',
  settings: 'settings',
  billing: 'settings',
  presets: 'settings',
  students: 'students',
  guardians: 'guardians',
  staff: 'staff',
  coordinators: 'classes',
  coordination: 'classes',
  'my-class': 'classes',
  classes: 'classes',
  academicYears: 'academicYears',
  'academic-year': 'academicYears',
  calendar: 'calendar',
  roles: 'roles',
  reports: 'reports',
  print: 'documents',
  certificates: 'documents',
  incidents: 'students',
  performance: 'students',
};

const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

describe('module coverage (D16, D46, D47)', () => {
  const navItems: StaffNavItemDef[] = [
    ...STAFF_TOP_NAV_ITEMS,
    ...STAFF_NAV_GROUPS.flatMap((g) => [...(g.pinnedItems ?? []), ...g.items]),
  ];

  // studyPlans has no sidebar item of its own (plans open from Syllabus), so a palette action counts.
  it('every ModuleKey is reachable from at least one nav item or palette action', () => {
    const tagged = new Set([
      ...Object.values<StaffNavItemDef>(STAFF_NAV_ITEMS).map((item) => item.module),
      ...ACTIONS.map((action) => action.module),
    ]);
    const missing = Object.values(ModuleKey).filter((key) => !tagged.has(key));
    expect(missing, `modules with no nav item or action: ${missing.join(', ')}`).toEqual([]);
  });

  it('every nav item has a module or is listed as core, never both', () => {
    const bad = navItems
      .filter((item) => (item.module !== undefined) === item.id in CORE_NAV)
      .map((item) => item.id);
    expect(bad, `nav item(s) with neither or both of module / core: ${bad.join(', ')}`).toEqual([]);
    const stale = Object.keys(CORE_NAV).filter((id) => !navItems.some((item) => item.id === id));
    expect(stale).toEqual([]);
  });

  it('every staff route has a module or a core area', () => {
    const bad = Object.keys(STAFF_ROUTE_PERMISSIONS).filter((id) => {
      const segment = id.split('/')[2] ?? '';
      return routeModule(id) === undefined && !(segment in CORE_ROUTE_SEGMENT);
    });
    expect(bad, `route(s) with neither module nor core area: ${bad.join(', ')}`).toEqual([]);
  });

  it('a route id on a module prefix resolves to that module, siblings stay core', () => {
    expect(routeModule('/_staff/fees/fines/rules')).toBe(ModuleKey.fines);
    expect(routeModule('/_staff/fees/dues')).toBe(ModuleKey.fees);
    expect(routeModule('/_staff/exams/seat-plans/$planId')).toBe(ModuleKey.seatPlans);
    expect(routeModule('/_staff/attendance/staff/leave')).toBe(ModuleKey.staffAttendance);
    expect(routeModule('/_staff/staff/evaluations_/surveys/$surveyId')).toBe(ModuleKey.evaluations);
    expect(routeModule('/_staff/communications/send-alert')).toBeUndefined();
    expect(routeModule('/_staff/students/')).toBeUndefined();
    expect(routeModule('/_staff/feesx')).toBeUndefined();
  });

  it('every route a nav item links to carries the same module as the item', () => {
    const mismatched = navItems
      .filter((item) => item.module !== undefined)
      .filter((item) => {
        const id = [`/_staff${item.to}/`, `/_staff${item.to}`].find((r) => r in router.routesById);
        return id !== undefined && routeModule(id) !== item.module;
      })
      .map((item) => item.id);
    expect(mismatched).toEqual([]);
  });

  it('every palette action has a module or a core area', () => {
    const bad = ACTIONS.filter(
      (action) => action.module === undefined && !(action.id.split('.')[0]! in CORE_ACTION_PREFIX),
    ).map((action) => action.id);
    expect(bad, `action(s) with neither module nor core area: ${bad.join(', ')}`).toEqual([]);
  });
});
