// [30.2.3] Wave-close contract test: proves the server contract behind
// `GET /search` ([30.2.1], `server/src/modules/search/`), the client
// types (`ui/src/api/schema.d.ts`, regenerated in #857) and the permission
// matrix (`permission-matrix.e2e-spec.ts`) it's built against actually
// holds end to end. Pure API-level, like `journeys/step-up.spec.ts` — the
// UI-side palette wiring is a separate concern; this only pins the shape
// and role-narrowing the client relies on.
//
// Locale is `bn` (the e2e default, `e2e/i18n.ts`'s `DEFAULT_LOCALE`) so
// every assertion below is on response *structure* (ids, group keys,
// `matched_via`) — never on English copy, which wouldn't even render in
// that locale.
//
// Fixture data is created fresh per test via the API, not drawn from the
// shared demo seed (`ensureDemoStudents`) — that data is reused across
// every spec in the same worker's database and can be mutated by an
// unrelated spec running in parallel, which is exactly what made an
// earlier version of this file flaky in CI despite passing locally every
// time. A guardian phone this test creates itself can't collide with
// anything else.
import { adminApiSession, apiSession, createGuardian, createStudentWithGuardian, get } from './api';
import { expect, loggedIn, test } from './fixtures/test';

/** `server/src/modules/search/dto/search.dto.ts`'s `SearchResultsDto` —
 * duplicated rather than imported since e2e specs don't reach into
 * `server/src`; shape drift would fail assertions directly. */
interface SearchStudentResult {
  id: string;
  full_name: string;
  registration_number: string;
  matched_via: 'direct' | 'guardian_phone';
}
interface SearchGuardianResult {
  id: string;
  full_name: string;
  phone: string | null;
}
interface SearchResults {
  students?: SearchStudentResult[];
  guardians?: SearchGuardianResult[];
  staff?: unknown[];
  invoices?: unknown[];
  payments?: unknown[];
}

test.describe('admin', () => {
  test.use(loggedIn('admin'));

  test('admin searching a student by registration number gets that student', async ({
    request,
  }) => {
    const admin = await adminApiSession(request);
    const guardian = await createGuardian(
      request,
      admin,
      'Search Contract Guardian',
      '01799911111',
    );
    const student = await createStudentWithGuardian(
      request,
      admin,
      'Search Contract Student',
      guardian.id,
    );
    const registrationNumber = await studentRegistrationNumber(request, admin, student.id);

    const results = await get<SearchResults>(
      request,
      admin,
      `/search?q=${encodeURIComponent(registrationNumber)}`,
    );

    expect(results.students).toBeDefined();
    const match = results.students?.find((s) => s.id === student.id);
    expect(match).toBeDefined();
    expect(match?.matched_via).toBe('direct');
  });

  test('admin searching a guardian phone gets the guardian and the linked student', async ({
    request,
  }) => {
    const admin = await adminApiSession(request);
    const phone = uniquePhone();
    const guardian = await createGuardian(request, admin, 'Search Contract Guardian Two', phone);
    const student = await createStudentWithGuardian(
      request,
      admin,
      'Search Contract Child',
      guardian.id,
    );

    const results = await get<SearchResults>(
      request,
      admin,
      `/search?q=${encodeURIComponent(phone)}`,
    );

    expect(results.guardians).toBeDefined();
    const guardianMatch = results.guardians?.find((g) => g.id === guardian.id);
    expect(guardianMatch).toBeDefined();
    expect(guardianMatch?.phone).toBe(phone);

    expect(results.students).toBeDefined();
    const studentMatch = results.students?.find((s) => s.id === student.id);
    expect(studentMatch).toBeDefined();
    expect(studentMatch?.matched_via).toBe('guardian_phone');
  });
});

test.describe('teacher', () => {
  test.use(loggedIn('teacher'));

  test('teacher gets no invoices group — object-scoped INVOICE_READ narrowed off /search', async ({
    request,
  }) => {
    const teacher = await apiSession(request, 'teacher');
    const results = await get<SearchResults>(request, teacher, '/search?q=anything');

    // A group the caller cannot read is absent entirely, not an empty
    // array (`SearchResultsDto`'s own doc comment) — assert the key is
    // missing, not just empty.
    expect(results.invoices).toBeUndefined();
  });
});

/** Fresh 11-digit BD mobile number, collision-proof within a single test
 * run — `createGuardian`'s own default is a fixed literal, unsuitable
 * when a test needs to search for the phone it just created. */
function uniquePhone(): string {
  const suffix = String(Date.now() % 100000000).padStart(8, '0');
  return `017${suffix}`;
}

async function studentRegistrationNumber(
  request: Parameters<typeof get>[0],
  session: Parameters<typeof get>[1],
  studentId: string,
): Promise<string> {
  const student = await get<{ registration_number: string }>(
    request,
    session,
    `/students/${studentId}`,
  );
  return student.registration_number;
}
