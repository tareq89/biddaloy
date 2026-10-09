import { http, HttpResponse } from 'msw';

import type { components } from '../../../api/schema';

/**
 * [52.4.1] The `_staff` layout fetches the nav badge count on every render, so every
 * layout test needs it answered. Nothing waiting is the quiet default (no badge).
 */
const pendingCount = http.get('/api/v1/applications/pending-count', () =>
  HttpResponse.json<components['schemas']['PendingCountDto']>({
    total: 0,
    by_type: [],
    oldest_pending_at: null,
  }),
);

export const applicationDefaultHandlers = [pendingCount];
