import { http, HttpResponse } from 'msw';

import {
  pendingSurveyFactory,
  surveyDetailFactory,
  surveyFactory,
  surveyResultsFactory,
} from '../../factories/surveys';

/** [28.4.1] `/surveys` happy-path fixtures. */
export const surveyDefaultHandlers = [
  http.get('/api/v1/surveys/mine', () => HttpResponse.json([pendingSurveyFactory()])),
  http.get('/api/v1/surveys', () => HttpResponse.json([surveyFactory()])),
  http.post('/api/v1/surveys', () => HttpResponse.json(surveyDetailFactory(), { status: 201 })),
  http.get('/api/v1/surveys/:id/results', ({ params }) =>
    HttpResponse.json(surveyResultsFactory({ surveyId: String(params.id) })),
  ),
  http.get('/api/v1/surveys/:id', ({ params }) =>
    HttpResponse.json(surveyDetailFactory({ id: String(params.id) })),
  ),
  http.post('/api/v1/surveys/:id/publish', ({ params }) =>
    HttpResponse.json(surveyDetailFactory({ id: String(params.id), status: 'OPEN' }), {
      status: 201,
    }),
  ),
  http.post('/api/v1/surveys/:id/close', ({ params }) =>
    HttpResponse.json(surveyDetailFactory({ id: String(params.id), status: 'CLOSED' }), {
      status: 201,
    }),
  ),
  http.post('/api/v1/surveys/:id/respond', () =>
    HttpResponse.json({ submitted: true }, { status: 201 }),
  ),
];
