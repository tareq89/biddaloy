// [8.5.3] Thin API helper for specs that need seeded-on-the-fly data —
// a fresh access token via the refresh cookie already in the test's
// request context, then tenant-scoped calls with the same headers the
// SPA sends (Bearer + X-Tenant-ID).
import type { APIRequestContext } from '@playwright/test';

import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from './seed-contract';

interface RefreshResponse {
  access_token: string;
  memberships: { tenantId: string; role: string; name: string }[];
}

export interface ApiSession {
  token: string;
  tenantId: string;
}

/** Fresh admin login independent of the test's own storage state — for
 * seeding data while the browser runs as a less-privileged role. Its own
 * token family, so it never trips refresh-rotation reuse detection. */
export async function adminApiSession(request: APIRequestContext): Promise<ApiSession> {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
  const response = await request.post('/api/v1/auth/login', {
    data: { email: SEED_ROLE_EMAILS.admin, password },
  });
  if (!response.ok()) {
    throw new Error(`admin login failed: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as RefreshResponse;
  const membership = body.memberships.find((m) => m.role === 'ADMIN');
  if (!membership) throw new Error('no ADMIN membership for seed admin');
  return { token: body.access_token, tenantId: membership.tenantId };
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

/** [9.11] `journeys/attendance.spec.ts`'s "server state" leg — asserts
 * through the API rather than re-reading the UI it just wrote, since a UI
 * that lies to itself would pass a UI-only assertion. */
export async function get<T>(
  request: APIRequestContext,
  session: ApiSession,
  path: string,
): Promise<T> {
  const response = await request.get(`/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      'X-Tenant-ID': session.tenantId,
    },
  });
  if (!response.ok()) {
    throw new Error(`GET ${path} failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** Students require a real class section (`class_section_id` is a
 * mandatory UUID) — build the academic-year → class → section chain
 * once per call. Unique names keep this idempotent-enough for a shared
 * seeded database. */
export interface ClassSectionChain {
  academicYearId: string;
  classId: string;
  sectionId: string;
  className: string;
}

export async function createClassSection(
  request: APIRequestContext,
  session: ApiSession,
): Promise<ClassSectionChain> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const className = `E2E ${suffix}`.slice(0, 50);
  const year = await post<{ id: string }>(request, session, '/academic-years', {
    name: `E2E Year ${suffix}`,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
  });
  const klass = await post<{ id: string }>(request, session, '/classes', {
    name: className,
    academic_year_id: year.id,
  });
  const section = await post<{ id: string }>(request, session, `/classes/${klass.id}/sections`, {
    section_name: 'A',
  });
  return { academicYearId: year.id, classId: klass.id, sectionId: section.id, className };
}

export async function createGuardian(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
): Promise<{ id: string }> {
  return post<{ id: string }>(request, session, '/guardians', {
    full_name: fullName,
    relationship: 'Father',
    phone: '01712345678',
  });
}

/** A staff member (tenant user) for the /staff/$userId detail page —
 * `POST /users` creates the account plus the school membership in one
 * call and returns both. */
export async function createStaffUser(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
): Promise<{ id: string }> {
  const created = await post<{ user: { id: string } }>(request, session, '/users', {
    full_name: fullName,
    email: `staff-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.example.com`,
    role: 'TEACHER',
    // CreateUserDto requires tenantId in the body even though the server
    // resolves the tenant from X-Tenant-ID — same as the add-user dialog.
    tenantId: session.tenantId,
  });
  return { id: created.user.id };
}

/** A staff member created passwordless, for `journeys/activation.spec.ts`
 * (12.2) — `POST /users` with no `password` issues an invite, and
 * `ACCOUNT_ACCESS_ECHO_SECRETS=true` (see `server/.env.example`, required
 * for this spec to run at all) puts the raw token in
 * `invitation.debug.token` so the spec can build the `/activate?token=…`
 * link without scraping the delivery provider's logs. */
export async function createInvitedStaffUser(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
): Promise<{ id: string; token: string }> {
  const created = await post<{ user: { id: string }; invitation: { debug?: { token: string } } }>(
    request,
    session,
    '/users',
    {
      full_name: fullName,
      email: `activate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.example.com`,
      role: 'TEACHER',
      tenantId: session.tenantId,
    },
  );
  const token = created.invitation.debug?.token;
  if (!token) {
    throw new Error(
      'No invitation.debug.token in the response — is ACCOUNT_ACCESS_ECHO_SECRETS=true set?',
    );
  }
  return { id: created.user.id, token };
}

/** A guardian user created passwordless with a unique phone, for
 * `journeys/password-recovery.spec.ts` (12.4) — same `POST /users` +
 * `ACCOUNT_ACCESS_ECHO_SECRETS` trick as `createInvitedStaffUser`, but
 * with `phone` instead of `email` (recovery via phone OTP needs a real
 * phone-identified account) and consumed straight through 12.2's
 * `/activate` flow so the account ends up with a real password before the
 * recovery spec ever touches it. */
export async function createInvitedParentUser(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
): Promise<{ id: string; phone: string; token: string }> {
  const phone = `017${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const created = await post<{ user: { id: string }; invitation: { debug?: { token: string } } }>(
    request,
    session,
    '/users',
    {
      full_name: fullName,
      phone,
      role: 'PARENT',
      tenantId: session.tenantId,
    },
  );
  const token = created.invitation.debug?.token;
  if (!token) {
    throw new Error(
      'No invitation.debug.token in the response — is ACCOUNT_ACCESS_ECHO_SECRETS=true set?',
    );
  }
  return { id: created.user.id, phone, token };
}

/** N students in one shared, freshly-created section — for pagination
 * specs that need more than a page's worth of rows without paying for a
 * class chain per student. */
export async function createStudentsInSection(
  request: APIRequestContext,
  session: ApiSession,
  namePrefix: string,
  count: number,
): Promise<ClassSectionChain> {
  const chain = await createClassSection(request, session);
  for (let i = 1; i <= count; i += 1) {
    await post(request, session, '/students', {
      full_name: `${namePrefix} ${String(i).padStart(2, '0')}`,
      class_section_id: chain.sectionId,
    });
  }
  return chain;
}

/** A reminder batch for the /communications/batches/$batchId detail
 * page — a student with open dues and a linked guardian (so the batch
 * has at least one real recipient), then one bulk-reminder POST. */
export async function createReminderBatch(
  request: APIRequestContext,
  session: ApiSession,
  batchName: string,
): Promise<{ id: string }> {
  const guardian = await createGuardian(request, session, `${batchName} Guardian`);
  const { studentId } = await createStudentWithDues(request, session, `${batchName} Student`, {
    guardianId: guardian.id,
  });
  return post<{ id: string }>(request, session, '/communications/reminder/bulk', {
    student_ids: [studentId],
    message_template: 'Dear {{guardian_name}}, {{student_name}} has dues of {{due_amount}}.',
    batch_name: batchName,
  });
}

export async function createInvoice(
  request: APIRequestContext,
  session: ApiSession,
  studentId: string,
): Promise<{ id: string }> {
  return post<{ id: string }>(request, session, '/invoices', {
    student_id: studentId,
    line_items: [{ description: 'E2E line item', amount: 100 }],
  });
}

/** A student with an outstanding fee: builds the class chain, a fee
 * structure for that class, and generates the month's StudentFee rows.
 * Returns everything a fee journey needs. */
export async function createStudentWithDues(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
  options: { amount?: number; guardianId?: string } = {},
): Promise<{ studentId: string; chain: ClassSectionChain }> {
  const chain = await createClassSection(request, session);
  const student = await post<{ id: string }>(request, session, '/students', {
    full_name: fullName,
    class_section_id: chain.sectionId,
    ...(options.guardianId ? { guardian_ids: [options.guardianId] } : {}),
  });
  await post(request, session, '/fee-structures', {
    fee_type: 'MONTHLY_TUITION',
    name: `E2E Tuition ${Date.now()}`,
    amount: options.amount ?? 500,
    class_id: chain.classId,
    academic_year_id: chain.academicYearId,
    month: 1,
  });
  await post(request, session, '/fees/generate', {
    academic_year_id: chain.academicYearId,
    month: 1,
    year: 2026,
    class_id: chain.classId,
  });
  return { studentId: student.id, chain };
}

export async function createStudent(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
): Promise<{ id: string }> {
  const chain = await createClassSection(request, session);
  return post<{ id: string }>(request, session, '/students', {
    full_name: fullName,
    class_section_id: chain.sectionId,
  });
}

/** A brand-new tenant user with role TEACHER, its own Teacher profile,
 * and an explicit password (bypassing the invite-email flow, which
 * nothing in this environment can deliver) so a spec can log in as
 * this exact teacher — as opposed to `loggedIn('teacher')`, which is
 * the one shared seeded account and must never have its section
 * mappings mutated by an individual spec (other specs use it purely
 * for role/permission checks and could run in a parallel worker). */
export interface FreshTeacher {
  email: string;
  password: string;
  userId: string;
  teacherId: string;
}

export async function createTeacherForSection(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
  sectionId: string,
): Promise<FreshTeacher> {
  // `crypto.randomUUID()`, not `Math.random()` — CodeQL flags `Math.random()`
  // as insecure randomness wherever the value it seeds ends up in a field
  // named like a credential (`password` here), even in test-only code.
  const suffix = crypto.randomUUID();
  const email = `teacher-${suffix}@e2e.example.com`;
  const password = `E2e-Teacher-${suffix}`;
  const created = await post<{ user: { id: string } }>(request, session, '/users', {
    full_name: fullName,
    email,
    password,
    role: 'TEACHER',
    tenantId: session.tenantId,
  });
  const teacher = await post<{ id: string }>(request, session, '/teachers', {
    user_id: created.user.id,
    employee_id: `E2E-${suffix}`,
    assigned_section_ids: [sectionId],
  });
  return { email, password, userId: created.user.id, teacherId: teacher.id };
}

/** Logs in as an arbitrary email/password (not a seed-contract role) and
 * returns Playwright storage state for a fresh browser context — the
 * same shape `e2e/fixtures/test.ts`'s `freshLogin` builds for seeded
 * accounts, generalised for a teacher created on the fly by
 * `createTeacherForSection`. */
export async function loginAsFreshUser(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
): Promise<{
  cookies: Awaited<ReturnType<APIRequestContext['storageState']>>['cookies'];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
}> {
  const response = await request.post('/api/v1/auth/login', { data: { email, password } });
  if (!response.ok()) {
    throw new Error(`login failed for ${email}: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    memberships: { tenantId: string; role: string }[];
  };
  const membership = body.memberships[0];
  if (!membership) throw new Error(`no membership in login response for ${email}`);
  const state = await request.storageState();
  return {
    cookies: state.cookies,
    origins: [
      {
        origin: baseURL.replace(/\/$/, ''),
        localStorage: [
          {
            name: 'biddaloy:activeTenant',
            value: JSON.stringify({ tenantId: membership.tenantId, role: membership.role }),
          },
        ],
      },
    ],
  };
}
