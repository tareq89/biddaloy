import type { APIRequestContext } from '@playwright/test';

import {
  adminApiSession,
  createClassSection,
  createGuardian,
  createInvoice,
  createStudentWithDues,
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
  if (route.path.includes('$invoiceId')) {
    const { studentId } = await createStudentWithDues(request, session, `Reflow Invoicee ${stamp}`);
    const invoice = await createInvoice(request, session, studentId);
    return route.path.replace('$invoiceId', invoice.id);
  }
  if (route.path.includes('$academicYearId') || route.path.includes('$classId')) {
    const chain = await createClassSection(request, session);
    return route.path
      .replace('$academicYearId', chain.academicYearId)
      .replace('$classId', chain.classId);
  }
  throw new Error(`no resolver for ${route.path}`);
}
