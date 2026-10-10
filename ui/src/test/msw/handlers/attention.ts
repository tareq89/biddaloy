import { http, HttpResponse } from 'msw';

import {
  attentionSummaryFactory,
  platformAttentionHealthFactory,
} from '../../factories/attention.factory';

/** [67.2.01] Empty-state defaults so shells mounting the bar don't hit `onUnhandledRequest: 'error'`. */
export const attentionDefaultHandlers = [
  http.get('*/attention/summary', () => HttpResponse.json(attentionSummaryFactory())),
  http.get('*/attention/items', () => HttpResponse.json({ items: [], total: 0 })),
  http.get('*/attention/students/:id', () => HttpResponse.json([])),
  http.get('*/platform/attention/health', () =>
    HttpResponse.json(platformAttentionHealthFactory()),
  ),
  http.get('*/attention/manual', () => HttpResponse.json({ items: [], total: 0 })),
  http.post('*/attention/manual/preview', () => HttpResponse.json({ recipientCount: 0 })),
  http.get('*/attention/report', ({ request }) =>
    HttpResponse.json({
      month: new URL(request.url).searchParams.get('month') ?? '',
      facts: {
        total: 0,
        resolved: 0,
        avgResolveMinutes: null,
        open: 0,
        openCritical: 0,
        previousMonthTotal: 0,
      },
      sections: [],
      rows: [],
    }),
  ),
  http.get('*/users/me/preferences/notifications', () =>
    HttpResponse.json({ mutedCategories: [], quietHours: { start: '21:00', end: '07:00' } }),
  ),
  http.post('*/attention/items/*', () => HttpResponse.json({ updated: 0 })),
];
