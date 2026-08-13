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
      merged[key] = { configured: true, hint: `••••${value.slice(-4)}` };
    } else {
      merged[key] = mergeAndMask(storedObj[key], value);
    }
  }
  return merged;
}

const schoolList = http.get('/api/v1/schools', () =>
  HttpResponse.json([
    { id: '00000000-0000-4000-8000-000000000001', name: 'Ananta School' },
    { id: '00000000-0000-4000-8000-000000000002', name: 'Zenith School' },
  ]),
);

const getSettings = http.get('/api/v1/schools/:id/settings', () =>
  HttpResponse.json(defaultSettings()),
);

// Merges the PATCH body onto the same default a GET would return — not a
// real persisted store, just enough to prove the response a test asserts
// against actually reflects the real controller's contract: touched
// secrets come back masked, untouched fields (region, version, and any
// communications the patch didn't mention) come back unchanged, and the
// plaintext the test just sent is never echoed.
const updateSettings = http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
  const body = (await request.json()) as Record<string, unknown>;
  const current = defaultSettings();
  return HttpResponse.json({
    ...current,
    version: 1,
    region: (body.region as Record<string, unknown>) ?? current.region,
    communications: mergeAndMask(current.communications, body.communications),
  });
});

const testConnection = http.post('/api/v1/schools/:id/settings/test', () =>
  HttpResponse.json({ success: true, message: 'Connected.' }),
);

export const schoolsHandlers = { schoolList, getSettings, updateSettings, testConnection };
export const schoolsDefaultHandlers = [schoolList, getSettings, updateSettings, testConnection];
