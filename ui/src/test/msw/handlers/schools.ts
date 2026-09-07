import { http, HttpResponse } from 'msw';

const DEFAULT_REGION = {
  locale: 'bn-BD',
  currency: {
    code: 'BDT',
    symbol: '৳',
    position: 'prefix' as const,
    decimals: 0,
    grouping: 'lakh-crore' as const,
  },
  numerals: 'bengali' as const,
  date: { format: 'DD/MM/YYYY', firstDayOfWeek: 0, calendar: 'gregorian' },
  phone: {
    country: 'BD',
    pattern: '^01[3-9]\\d{8}$',
    example: '01712345678',
    displayFormat: '01XXX-XXXXXX',
  },
  address: {
    fields: ['village', 'upazila', 'district'],
    order: ['village', 'upazila', 'district'],
  },
  academicYear: { startMonth: 1 },
  identifiers: { national: 'NID-##########', student: 'STU-####' },
  timezone: 'Asia/Dhaka',
};

function defaultSettings() {
  return {
    version: 1,
    region: DEFAULT_REGION,
    communications: {
      whatsapp: {
        phoneNumberId: '123456',
        apiVersion: 'v21.0',
        accessToken: { configured: true, hint: '••••oken' },
      },
      email: {
        host: 'smtp.example.com',
        port: 587,
        user: 'noreply',
        from: 'noreply@example.com',
        password: { configured: true, hint: '••••pass' },
      },
      sms: {
        provider: 'greenweb',
        greenweb: { apiKey: { configured: true, hint: '••••key1' } },
      },
    },
  };
}

const SECRET_FIELDS = new Set(['accessToken', 'password', 'apiKey']);

/** Same masking contract the real controller/`settings-mask.util.ts`
 * enforces: a submitted plaintext secret becomes `{ configured: true, hint
 * }`, an explicit `null` clears it to `{ configured: false }`, and an
 * omitted key leaves whatever was already stored untouched — never echoed
 * back as the plaintext the PATCH body carried in. */
function mergeAndMask(stored: unknown, patch: unknown): unknown {
  if (patch === undefined) return stored;
  if (patch === null) {
    return typeof stored === 'object' && stored !== null && 'configured' in stored
      ? { configured: false }
      : null;
  }
  if (Array.isArray(patch) || typeof patch !== 'object') return patch;

  const storedObj =
    typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const patchObj = patch as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...storedObj };

  for (const [key, value] of Object.entries(patchObj)) {
    if (SECRET_FIELDS.has(key) && typeof value === 'string') {
      // A value with four or fewer characters would have its whole
      // plaintext reflected back by `.slice(-4)` — omit the hint rather
      // than echo a short secret in full.
      merged[key] =
        value.length > 4
          ? { configured: true, hint: `••••${value.slice(-4)}` }
          : { configured: true };
    } else {
      merged[key] = mergeAndMask(storedObj[key], value);
    }
  }
  return merged;
}

// `slug`/`status`/`created_at` added by #533 alongside the original
// `id`/`name` (see `SchoolListItemDto`'s own comment) — kept here rather
// than a second handler so the #8.7.13 picker tests and #533's list tests
// share the same fixture data.
const schoolList = http.get('/api/v1/schools', () =>
  HttpResponse.json([
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Ananta School',
      slug: 'ananta-school',
      status: 'ACTIVE',
      created_at: '2026-01-15T00:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Zenith School',
      slug: 'zenith-school',
      status: 'SUSPENDED',
      created_at: '2026-03-20T00:00:00.000Z',
    },
  ]),
);

// Per-school in-memory store, seeded lazily from `defaultSettings()` — a
// real persisted store, unlike this file's other handlers, because a PATCH
// followed by a GET (or a second PATCH) needs to see the first PATCH's
// changes rather than always bouncing back to the same default. Cleared by
// `resetSchoolsStore()`, wired into `ui/src/test/setup.ts`'s `afterEach` so
// one test's edits never leak into the next.
// `Record<string, unknown>`, not `ReturnType<typeof defaultSettings>` —
// `mergeAndMask`'s result (stored back after every PATCH) is typed
// `unknown`, since the merge is generic over whatever shape the request
// body happens to carry.
const schoolSettingsStore = new Map<string, Record<string, unknown>>();

function getStoredSettings(schoolId: string): Record<string, unknown> {
  let settings = schoolSettingsStore.get(schoolId);
  if (!settings) {
    settings = defaultSettings();
    schoolSettingsStore.set(schoolId, settings);
  }
  return settings;
}

export function resetSchoolsStore(): void {
  schoolSettingsStore.clear();
  schoolProfileStore.name = 'Ananta School';
  schoolProfileStore.name_bn = null;
  schoolProfileStore.address = null;
  schoolProfileStore.phone = null;
  schoolProfileStore.email = null;
  schoolProfileStore.registration_id = null;
  schoolProfileStore.logo_url = null;
}

/**
 * [15.5.6] `/schools/me/profile` and `/schools/me/logo`, mirroring
 * `server/src/modules/schools/profile/*`'s contract — a single in-memory
 * profile (there's only one "me" in a test), reset by `resetSchoolsStore`
 * the same way `schoolSettingsStore` is.
 */
const schoolProfileStore: {
  name: string;
  name_bn: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  registration_id: string | null;
  logo_url: string | null;
} = {
  name: 'Ananta School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: null,
  logo_url: null,
};

const getProfile = http.get('/api/v1/schools/me/profile', () =>
  HttpResponse.json(schoolProfileStore),
);

const updateProfile = http.patch('/api/v1/schools/me/profile', async ({ request }) => {
  const body = (await request.json()) as Partial<typeof schoolProfileStore>;
  Object.assign(schoolProfileStore, body);
  return HttpResponse.json(schoolProfileStore);
});

const uploadLogo = http.post('/api/v1/schools/me/logo', () => {
  schoolProfileStore.logo_url = '/schools/me/logo?v=test-fixture';
  return HttpResponse.json({ logo_url: schoolProfileStore.logo_url }, { status: 201 });
});

const removeLogo = http.delete('/api/v1/schools/me/logo', () => {
  schoolProfileStore.logo_url = null;
  return new HttpResponse(null, { status: 204 });
});

const getSettings = http.get('/api/v1/schools/:id/settings', ({ params }) =>
  HttpResponse.json(getStoredSettings(params.id as string)),
);

// Merges the PATCH body onto the stored settings and persists the result —
// enough to prove the response a test asserts against actually reflects
// the real controller's contract: touched secrets come back masked,
// untouched fields (region, version, and any communications the patch
// didn't mention) come back unchanged, the plaintext the test just sent is
// never echoed, and a second PATCH doesn't discard what the first one set.
const updateSettings = http.patch('/api/v1/schools/:id/settings', async ({ request, params }) => {
  const body = (await request.json()) as Record<string, unknown>;
  const schoolId = params.id as string;
  const current = getStoredSettings(schoolId);
  const updated = {
    ...current,
    version: 1,
    region: (body.region as Record<string, unknown>) ?? current.region,
    communications: mergeAndMask(current.communications, body.communications),
  };
  schoolSettingsStore.set(schoolId, updated);
  return HttpResponse.json(updated);
});

const testConnection = http.post('/api/v1/schools/:id/settings/test', () =>
  HttpResponse.json({ success: true, message: 'Connected.' }),
);

export const schoolsHandlers = {
  schoolList,
  getSettings,
  updateSettings,
  testConnection,
  getProfile,
  updateProfile,
  uploadLogo,
  removeLogo,
};
export const schoolsDefaultHandlers = [
  schoolList,
  getSettings,
  updateSettings,
  testConnection,
  getProfile,
  updateProfile,
  uploadLogo,
  removeLogo,
];
