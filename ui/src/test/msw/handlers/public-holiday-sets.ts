import { http, HttpResponse } from 'msw';

/**
 * [17.3.5/#715] Platform public-holiday sets. In-memory store, same
 * "PATCH then GET sees the change" reasoning `schools.ts`'s
 * `schoolSettingsStore` documents — the detail page's save/publish flows
 * need to see their own prior mutation.
 */
export interface HolidayEntryFixture {
  id: string;
  date: string;
  end_date: string;
  name: string;
  name_bn: string | null;
}

export interface HolidaySetFixture {
  id: string;
  country: string;
  year: number;
  source: 'GOOGLE_ICS' | 'NAGER_DATE' | 'MANUAL';
  published_at: string | null;
  fetched_at: string;
  entries: HolidayEntryFixture[];
  created_at: string;
  updated_at: string;
}

const BD_2026_SET_ID = '00000000-0000-4000-9000-000000000001';

function defaultSets(): HolidaySetFixture[] {
  return [
    {
      id: BD_2026_SET_ID,
      country: 'BD',
      year: 2026,
      source: 'NAGER_DATE',
      published_at: '2026-01-05T00:00:00.000Z',
      fetched_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-05T00:00:00.000Z',
      entries: [
        {
          id: '00000000-0000-4000-9000-000000000011',
          date: '2026-02-21',
          end_date: '2026-02-21',
          name: 'International Mother Language Day',
          name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
        },
        {
          id: '00000000-0000-4000-9000-000000000012',
          date: '2026-03-26',
          end_date: '2026-03-26',
          name: 'Independence Day',
          name_bn: 'স্বাধীনতা দিবস',
        },
      ],
    },
  ];
}

let sets = defaultSets();

export function resetHolidaySetsStore(): void {
  sets = defaultSets();
}

const listSets = http.get('/api/v1/platform/holiday-sets', () => HttpResponse.json(sets));

const getSet = http.get('/api/v1/platform/holiday-sets/:id', ({ params }) => {
  const set = sets.find((s) => s.id === params.id);
  if (!set) return new HttpResponse(null, { status: 404 });
  return HttpResponse.json(set);
});

const fetchSet = http.post('/api/v1/platform/holiday-sets/fetch', async ({ request }) => {
  const body = (await request.json()) as { country: string; year: number };
  const existing = sets.find((s) => s.country === body.country && s.year === body.year);
  if (existing) return HttpResponse.json(existing, { status: 201 });
  const created: HolidaySetFixture = {
    id: crypto.randomUUID(),
    country: body.country,
    year: body.year,
    source: 'NAGER_DATE',
    published_at: null,
    fetched_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    entries: [],
  };
  sets = [...sets, created];
  return HttpResponse.json(created, { status: 201 });
});

const fetchSetError = http.post('/api/v1/platform/holiday-sets/fetch', () =>
  HttpResponse.json(
    {
      statusCode: 502,
      message: 'Both holiday sources failed.',
      timestamp: new Date().toISOString(),
      path: '/api/v1/platform/holiday-sets/fetch',
      requestId: crypto.randomUUID(),
    },
    { status: 502 },
  ),
);

const updateEntries = http.put(
  '/api/v1/platform/holiday-sets/:id/entries',
  async ({ params, request }) => {
    const body = (await request.json()) as { entries: HolidayEntryFixture[] };
    const set = sets.find((s) => s.id === params.id);
    if (!set) return new HttpResponse(null, { status: 404 });
    set.entries = body.entries.map((entry) => ({ ...entry, id: entry.id ?? crypto.randomUUID() }));
    set.updated_at = new Date().toISOString();
    return HttpResponse.json(set);
  },
);

const publish = http.post('/api/v1/platform/holiday-sets/:id/publish', ({ params }) => {
  const set = sets.find((s) => s.id === params.id);
  if (!set) return new HttpResponse(null, { status: 404 });
  set.published_at = new Date().toISOString();
  return HttpResponse.json(set, { status: 201 });
});

const unpublish = http.post('/api/v1/platform/holiday-sets/:id/unpublish', ({ params }) => {
  const set = sets.find((s) => s.id === params.id);
  if (!set) return new HttpResponse(null, { status: 404 });
  set.published_at = null;
  return HttpResponse.json(set, { status: 201 });
});

export const publicHolidaySetsHandlers = {
  listSets,
  getSet,
  fetchSet,
  fetchSetError,
  updateEntries,
  publish,
  unpublish,
};
export const publicHolidaySetsDefaultHandlers = [
  listSets,
  getSet,
  fetchSet,
  updateEntries,
  publish,
  unpublish,
];
export { BD_2026_SET_ID };
