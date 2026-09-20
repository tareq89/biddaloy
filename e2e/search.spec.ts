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
import { adminApiSession, apiSession, createClassSection, createGuardian, get, post } from './api';
import { expect, loggedIn, test } from './fixtures/test';

/** `server/src/modules/search/dto/search.dto.ts`'s `SearchResultsDto` —
 * duplicated rather than imported since e2e specs don't reach into
 * `server/src`; shape drift would fail assertions directly. */
interface SearchStudentResult {
  id: string;
  full_name: string;
  registration_number: string;
  roll_number: number;
  class_name: string | null;
  section_name: string | null;
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
    const chain = await createClassSection(request, admin);
    const fullName = 'Search Contract Student';
    const created = await post<{ id: string; registration_number: string; roll_number: number }>(
      request,
      admin,
      '/students',
      { full_name: fullName, class_section_id: chain.sectionId, guardian_ids: [guardian.id] },
    );

    const results = await get<SearchResults>(
      request,
      admin,
      `/search?q=${encodeURIComponent(created.registration_number)}`,
    );

    expect(results.students).toBeDefined();
    const match = results.students?.find((s) => s.id === created.id);
    // Full-object equality, not just id/matched_via — proves the search
    // result carries exactly the fields the DTO promises, not a superset
    // or subset. `find` above keeps this independent of result ordering
    // or additional unrelated matches in the response.
    expect(match).toEqual({
      id: created.id,
      full_name: fullName,
      registration_number: created.registration_number,
      roll_number: created.roll_number,
      class_name: chain.className,
      section_name: 'A',
      matched_via: 'direct',
    });
  });

  test('admin searching a guardian phone gets the guardian and the linked student', async ({
    request,
  }) => {
    const admin = await adminApiSession(request);
    const phone = uniquePhone();
    const guardianName = 'Search Contract Guardian Two';
    const guardian = await createGuardian(request, admin, guardianName, phone);
    const chain = await createClassSection(request, admin);
    const studentName = 'Search Contract Child';
    const created = await post<{ id: string; registration_number: string; roll_number: number }>(
      request,
      admin,
      '/students',
      { full_name: studentName, class_section_id: chain.sectionId, guardian_ids: [guardian.id] },
    );

    const results = await get<SearchResults>(
      request,
      admin,
      `/search?q=${encodeURIComponent(phone)}`,
    );

    expect(results.guardians).toBeDefined();
    const guardianMatch = results.guardians?.find((g) => g.id === guardian.id);
    expect(guardianMatch).toEqual({ id: guardian.id, full_name: guardianName, phone });

    expect(results.students).toBeDefined();
    const studentMatch = results.students?.find((s) => s.id === created.id);
    expect(studentMatch).toEqual({
      id: created.id,
      full_name: studentName,
      registration_number: created.registration_number,
      roll_number: created.roll_number,
      class_name: chain.className,
      section_name: 'A',
      matched_via: 'guardian_phone',
    });
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
