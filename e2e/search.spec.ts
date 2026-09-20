// [30.2.3] Wave-close contract test: proves the server contract behind
// `GET /search` ([30.2.1], `server/src/modules/search/`) that the client
// (`ui/src/api/schema.d.ts`, regenerated in #857) and the permission
// matrix (`permission-matrix.e2e-spec.ts`) were built against actually
// holds end to end. Pure API-level, like `journeys/step-up.spec.ts` — the
// UI-side palette wiring is a separate concern, this only pins the shape
// and role-narrowing the client relies on.
//
// Locale is `bn` (the e2e default, `e2e/i18n.ts`'s `DEFAULT_LOCALE`) so
// every assertion below is on response *structure* (ids, group keys,
// `matched_via`) — never on English copy, which wouldn't even render in
// this locale.
import { adminApiSession, apiSession, get } from './api';
import { expect, loggedIn, test } from './fixtures/test';

/** `server/src/modules/search/dto/search.dto.ts`'s `SearchResultsDto` —
 * duplicated here rather than imported since e2e specs don't reach into
 * `server/src`; a shape drift would fail these assertions directly. */
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

// Seeded by `ensureDemoStudents` (`server/src/scripts/seed.util.ts`):
// the first demo student (`registration_number` `${DEMO_ACADEMIC_YEAR.name}-0001`)
// is linked to the first demo guardian, whose phone is deterministic
// (`01710` + `100000` zero-padded). Both are stable across seed re-runs.
const SEEDED_STUDENT_REGISTRATION_NUMBER = '2026-2027-0001';
const SEEDED_GUARDIAN_PHONE = '01710100000';

test.describe('admin', () => {
  test.use(loggedIn('admin'));

  test('admin searching a seeded student registration number gets that student', async ({
    request,
  }) => {
    const admin = await adminApiSession(request);
    const results = await get<SearchResults>(
      request,
      admin,
      `/search?q=${encodeURIComponent(SEEDED_STUDENT_REGISTRATION_NUMBER)}`,
    );

    expect(results.students).toBeDefined();
    const match = results.students?.find(
      (s) => s.registration_number === SEEDED_STUDENT_REGISTRATION_NUMBER,
    );
    expect(match).toBeDefined();
    expect(match?.matched_via).toBe('direct');
  });

  test('admin searching a seeded guardian phone gets the guardian and the linked student', async ({
    request,
  }) => {
    const admin = await adminApiSession(request);
    const results = await get<SearchResults>(
      request,
      admin,
      `/search?q=${encodeURIComponent(SEEDED_GUARDIAN_PHONE)}`,
    );

    expect(results.guardians).toBeDefined();
    const guardianMatch = results.guardians?.find((g) => g.phone === SEEDED_GUARDIAN_PHONE);
    expect(guardianMatch).toBeDefined();

    expect(results.students).toBeDefined();
    const studentMatch = results.students?.find(
      (s) => s.registration_number === SEEDED_STUDENT_REGISTRATION_NUMBER,
    );
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
    const results = await get<SearchResults>(
      request,
      teacher,
      `/search?q=${encodeURIComponent(SEEDED_STUDENT_REGISTRATION_NUMBER)}`,
    );

    // A group the caller cannot read is absent entirely, not an empty
    // array (`SearchResultsDto`'s own doc comment) — assert the key is
    // missing, not just empty.
    expect(results.invoices).toBeUndefined();
  });
});
