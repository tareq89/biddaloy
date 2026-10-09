import { http, HttpResponse } from 'msw';

import { incidentFactory } from '../../factories/acr';

/** [28.3.1] `/incidents` happy-path fixtures, typed from `schema.d.ts`. */
const listIncidents = http.get('/api/v1/incidents', () =>
  HttpResponse.json([incidentFactory(), incidentFactory({ type: 'COMMENDATION' })]),
);
const createIncident = http.post('/api/v1/incidents', async ({ request }) => {
  const body = (await request.json()) as Record<string, unknown>;
  return HttpResponse.json(incidentFactory(body), { status: 201 });
});

export const incidentHandlers = {
  listEmpty: http.get('/api/v1/incidents', () => HttpResponse.json([])),
};

export const incidentDefaultHandlers = [listIncidents, createIncident];
