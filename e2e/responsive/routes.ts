import type { APIRequestContext } from '@playwright/test';

import {
  adminApiSession,
  createClassSection,
  createGuardian,
  createInvoice,
  createInvoiceShareToken,
  createReminderBatch,
  createStaffUser,
  createStudentWithDues,
  findSchoolIdBySlug,
  superAdminApiSession,
  type ApiSession,
} from '../api';
import manifest from '../route-manifest.json';

/** Shared manifest typing + param resolution for the responsive suites
 * (same resolution strategy as the a11y suite). */

export interface ManifestRoute {
  path: string;
  role: string;
  archetype: string;
  params?: Record<string, string>;
  overlays?: string[];
}

export const routes = (manifest as { routes: ManifestRoute[] }).routes;

// One admin login per worker process, not one per dynamic route resolved —
// every call in this file needs the same ADMIN session, and re-logging in
// for each of the manifest's several dynamic routes was pointless load on
// the auth endpoint.
let sharedSessionPromise: Promise<ApiSession> | null = null;

function sharedAdminSession(request: APIRequestContext): Promise<ApiSession> {
  sharedSessionPromise ??= adminApiSession(request);
  return sharedSessionPromise;
}

export async function resolvePath(
  request: APIRequestContext,
  route: ManifestRoute,
): Promise<string> {
  if (!route.path.includes('$')) return route.path;
  if (route.path.includes('$schoolId')) {
    // SUPER_ADMIN platform console (#535) — `GET /schools` is SUPER_ADMIN
    // only, so this can't ride the shared ADMIN session. Resolves the
    // seeded second school the same way `provision-and-suspend.spec.ts`
    // does, rather than provisioning a fresh one per viewport/theme run.
    const superAdmin = await superAdminApiSession(request);
    const schoolId = await findSchoolIdBySlug(request, superAdmin, 'rose-valley-school');
    return route.path.replace('$schoolId', schoolId);
  }
  const session: ApiSession = await sharedAdminSession(request);
  const stamp = Date.now();
  if (route.path.includes('$studentId')) {
    const { studentId } = await createStudentWithDues(request, session, `Reflow Student ${stamp}`);
    return route.path.replace('$studentId', studentId);
  }
  if (route.path.includes('$guardianId')) {
    const guardian = await createGuardian(request, session, `Reflow Guardian ${stamp}`);
    return route.path.replace('$guardianId', guardian.id);
  }
  if (route.path.includes('$userId')) {
    const staffUser = await createStaffUser(request, session, `Reflow Staff ${stamp}`);
    return route.path.replace('$userId', staffUser.id);
  }
  if (route.path.includes('$batchId')) {
    const batch = await createReminderBatch(request, session, `Reflow Batch ${stamp}`);
    return route.path.replace('$batchId', batch.id);
  }
  if (route.path.includes('$invoiceId')) {
    const { studentId } = await createStudentWithDues(request, session, `Reflow Invoicee ${stamp}`);
    const invoice = await createInvoice(request, session, studentId);
    return route.path.replace('$invoiceId', invoice.id);
  }
  if (route.path.includes('$token')) {
    // [16.5.3] `/i/$token` — the unauthenticated public receipt route.
    const { studentId } = await createStudentWithDues(request, session, `Reflow Receipt ${stamp}`);
    const invoice = await createInvoice(request, session, studentId);
    const token = await createInvoiceShareToken(request, session, invoice.id);
    return route.path.replace('$token', token);
  }
  if (route.path.includes('$academicYearId') || route.path.includes('$classId')) {
    const chain = await createClassSection(request, session);
    return route.path
      .replace('$academicYearId', chain.academicYearId)
      .replace('$classId', chain.classId);
  }
  if (route.path.includes('$sectionId')) {
    // [9.6] No mapped teacher for this section — the admin session used
    // throughout this file has `ATTENDANCE_READ`, so the register still
    // renders (just with an empty/unmarked roster), which is all the
    // responsive-layout check below needs.
    const chain = await createClassSection(request, session);
    const path = route.path.replace('$sectionId', chain.sectionId);
    // [21.8.1] `/routines/$sectionId` also needs `?classId=` — the route
    // has no other way to find the section's class (see `$sectionId.tsx`'s
    // own doc comment) and renders `noClassIdExplanation` without it. The
    // manifest itself can't carry query params, so it's added here instead.
    return path.startsWith('/routines/') ? `${path}?classId=${chain.classId}` : path;
  }
  throw new Error(`no resolver for ${route.path}`);
}
