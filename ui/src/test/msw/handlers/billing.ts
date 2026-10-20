import { http, HttpResponse } from 'msw';

// Epic 49: `GET /billing/summary`. The admin layout reads `read_only_until` on every page, so
// the happy path is "not over the seat limit": a bare school with nothing bought.
const summary = http.get('/api/v1/billing/summary', () =>
  HttpResponse.json({
    free_until: '2026-12-31T18:00:00.000Z',
    seats_bought: 0,
    seats_used: 0,
    paid_until: null,
    read_only_until: null,
    orders: [],
  }),
);

export const billingDefaultHandlers = [summary];
