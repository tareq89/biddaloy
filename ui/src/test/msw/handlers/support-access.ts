import { http, HttpResponse } from 'msw';

import type { SupportAccessSettings } from '../../../hooks/support-access';

/** School-side Login as consent (Epic 99). Fake data only. */
export const supportSettingsFixture = (
  overrides: Partial<SupportAccessSettings> = {},
): SupportAccessSettings => ({
  mode: 'allowed',
  confirmedAt: '2029-12-01T00:00:00.000Z',
  confirmedByName: 'Nabil Karim',
  textVersion: 1,
  currentTextVersion: 1,
  needsConfirmation: false,
  ...overrides,
});

export const supportRequestFixture = {
  id: '00000000-0000-4000-8000-000000000901',
  kind: 'ASK',
  ownerName: 'Owner One',
  role: 'TEACHER',
  personName: 'Anika Rahman',
  reason: 'Parent could not see the timetable',
  requestedAt: '2029-12-31T00:00:00.000Z',
  expiresAt: '2030-01-01T00:00:00.000Z',
  status: 'REQUESTED',
};

export const supportSessionFixture = {
  id: '00000000-0000-4000-8000-000000000902',
  ownerName: 'Owner One',
  startedAt: '2029-12-31T00:00:00.000Z',
  endedAt: null,
  status: 'ACTIVE',
  kind: 'NORMAL',
  viewOnly: true,
  role: 'TEACHER',
  personName: 'Anika Rahman',
  reason: 'Parent could not see the timetable',
  changedCount: 0,
};

export const supportAccessHandlers = {
  /** Swap in another consent state: `server.use(supportAccessHandlers.settings({ mode: 'ask' }))`. */
  settings: (overrides: Partial<SupportAccessSettings>) =>
    http.get('*/support-access/settings', () =>
      HttpResponse.json(supportSettingsFixture(overrides)),
    ),
};

export const supportAccessDefaultHandlers = [
  http.get('*/support-access/settings', () => HttpResponse.json(supportSettingsFixture())),
  http.put('*/support-access/settings', async ({ request }) => {
    const { mode } = (await request.json()) as { mode: SupportAccessSettings['mode'] };
    return HttpResponse.json(supportSettingsFixture({ mode }));
  }),
  http.post('*/support-access/confirm', () => HttpResponse.json(supportSettingsFixture())),
  http.get('*/support-access/requests', () => HttpResponse.json([supportRequestFixture])),
  http.post('*/support-access/requests/:id/approve', ({ params }) =>
    HttpResponse.json({ id: params.id, status: 'APPROVED' }, { status: 201 }),
  ),
  http.post('*/support-access/requests/:id/deny', ({ params }) =>
    HttpResponse.json({ id: params.id, status: 'DENIED' }, { status: 201 }),
  ),
  http.get('*/support-access/sessions', () => HttpResponse.json([supportSessionFixture])),
  http.get('*/support-access/platform-actions', () =>
    HttpResponse.json([
      {
        id: '00000000-0000-4000-8000-000000000903',
        at: '2029-12-31T00:00:00.000Z',
        actorName: 'Owner One',
        label: 'Signed everyone out',
        reason: null,
      },
    ]),
  ),
  http.post('*/support-access/sessions/:id/end', ({ params }) =>
    HttpResponse.json({ id: params.id, status: 'ENDED' }),
  ),
];
