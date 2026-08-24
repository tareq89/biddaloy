// [8.5.3] Thin API helper for specs that need seeded-on-the-fly data —
// a fresh access token via the refresh cookie already in the test's
// request context, then tenant-scoped calls with the same headers the
// SPA sends (Bearer + X-Tenant-ID).
import type { APIRequestContext } from '@playwright/test';

interface RefreshResponse {
  access_token: string;
  memberships: { tenantId: string; role: string; name: string }[];
}

export interface ApiSession {
  token: string;
  tenantId: string;
}

export async function apiSession(request: APIRequestContext, role: string): Promise<ApiSession> {
  const response = await request.post('/api/v1/auth/refresh');
  if (!response.ok()) {
    throw new Error(`refresh failed: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as RefreshResponse;
  const membership = body.memberships.find((m) => m.role === role.toUpperCase());
  if (!membership) throw new Error(`no ${role} membership on this session`);
  return { token: body.access_token, tenantId: membership.tenantId };
}

async function post<T>(
  request: APIRequestContext,
  session: ApiSession,
  path: string,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await request.post(`/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      'X-Tenant-ID': session.tenantId,
    },
    data,
  });
  if (!response.ok()) {
    throw new Error(`POST ${path} failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** Students require a real class section (`class_section_id` is a
 * mandatory UUID) — build the academic-year → class → section chain
 * once per call. Unique names keep this idempotent-enough for a shared
 * seeded database. */
export async function createClassSection(
  request: APIRequestContext,
  session: ApiSession,
): Promise<{ id: string }> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const year = await post<{ id: string }>(request, session, '/academic-years', {
    name: `E2E Year ${suffix}`,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
  });
  const klass = await post<{ id: string }>(request, session, '/classes', {
    name: `E2E ${suffix}`.slice(0, 50),
    academic_year_id: year.id,
  });
  return post<{ id: string }>(request, session, `/classes/${klass.id}/sections`, {
    section_name: 'A',
  });
}

export async function createStudent(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
): Promise<{ id: string }> {
  const section = await createClassSection(request, session);
  return post<{ id: string }>(request, session, '/students', {
    full_name: fullName,
    class_section_id: section.id,
  });
}
