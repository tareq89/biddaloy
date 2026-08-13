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

const schoolList = http.get('/api/v1/schools', () =>
  HttpResponse.json([
    { id: '00000000-0000-4000-8000-000000000001', name: 'Ananta School' },
    { id: '00000000-0000-4000-8000-000000000002', name: 'Zenith School' },
  ]),
);

const getSettings = http.get('/api/v1/schools/:id/settings', () =>
  HttpResponse.json({
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
  }),
);

const updateSettings = http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
  const body = (await request.json()) as Record<string, unknown>;
  return HttpResponse.json({
    version: 1,
    region: DEFAULT_REGION,
    communications: (body.communications as Record<string, unknown>) ?? {},
  });
});

const testConnection = http.post('/api/v1/schools/:id/settings/test', () =>
  HttpResponse.json({ success: true, message: 'Connected.' }),
);

export const schoolsHandlers = { schoolList, getSettings, updateSettings, testConnection };
export const schoolsDefaultHandlers = [schoolList, getSettings, updateSettings, testConnection];
