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
  http.post('*/attention/items/*', () => HttpResponse.json({ updated: 0 })),
];
