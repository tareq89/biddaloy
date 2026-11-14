import { TENANT_SETTINGS_SCHEMA_VERSION, type SchoolLabels, type SchoolModules } from '@biddaloy/shared';
import type { APIRequestContext } from '@playwright/test';

import { patch, type ApiSession } from '../api';

/**
 * [Epic 77] Turn modules on or off for the session's school, over the API as ADMIN (pass
 * `adminApiSession(request)`). `null` for a key removes it, so a test can put things back.
 */
export async function setModules(
  request: APIRequestContext,
  session: ApiSession,
  modules: { [K in keyof SchoolModules]: SchoolModules[K] | null },
): Promise<void> {
  await patch(request, session, `/schools/${session.tenantId}/settings`, {
    version: TENANT_SETTINGS_SCHEMA_VERSION,
    modules,
  });
}

/** Same for renamed words. */
export async function setLabels(
  request: APIRequestContext,
  session: ApiSession,
  labels: { [K in keyof SchoolLabels]: SchoolLabels[K] | null },
): Promise<void> {
  await patch(request, session, `/schools/${session.tenantId}/settings`, {
    version: TENANT_SETTINGS_SCHEMA_VERSION,
    labels,
  });
}
