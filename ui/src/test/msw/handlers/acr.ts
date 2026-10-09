import { http, HttpResponse } from 'msw';

import type { AcrCriteriaSet } from '../../../hooks/acr';
import { acrAssessmentFactory, acrCriterionFactory } from '../../factories/acr';

/** [28.3.1] `/acr/*` happy-path fixtures, typed from `schema.d.ts`. */
const criteriaSet = (): AcrCriteriaSet => ({
  id: 'criteria-v1',
  version: 1,
  criteria: [
    acrCriterionFactory({ block: 'BLOCK_2', code: 'PUNCTUALITY', sort_order: 1 }),
    acrCriterionFactory({ block: 'BLOCK_3', code: 'TEAMWORK', sort_order: 2 }),
  ],
});

const getCriteria = http.get('/api/v1/acr/criteria', () => HttpResponse.json(criteriaSet()));
const saveCriteria = http.put('/api/v1/acr/criteria', async ({ request }) => {
  const body = (await request.json()) as Pick<AcrCriteriaSet, 'criteria'>;
  return HttpResponse.json({
    id: 'criteria-v2',
    version: 2,
    criteria: body.criteria.map((c, i) => ({ ...c, id: `criterion-${i}` })),
  });
});
const listAssessments = http.get('/api/v1/acr/assessments', () =>
  HttpResponse.json([acrAssessmentFactory()]),
);
const startAssessment = http.post('/api/v1/acr/assessments', async ({ request }) => {
  const body = (await request.json()) as { user_id: string; academic_year_id: string };
  return HttpResponse.json(acrAssessmentFactory(body), { status: 201 });
});
const getAssessment = http.get('/api/v1/acr/assessments/:id', ({ params }) =>
  HttpResponse.json(acrAssessmentFactory({ id: params.id as string })),
);
const patchAssessment = http.patch('/api/v1/acr/assessments/:id', ({ params }) =>
  HttpResponse.json(acrAssessmentFactory({ id: params.id as string })),
);
const completeAssessment = http.post('/api/v1/acr/assessments/:id/complete', ({ params }) =>
  HttpResponse.json(
    acrAssessmentFactory({ id: params.id as string, status: 'COMPLETED', total: 10 }),
    { status: 201 },
  ),
);
const reopenAssessment = http.post('/api/v1/acr/assessments/:id/reopen', ({ params }) =>
  HttpResponse.json(acrAssessmentFactory({ id: params.id as string }), { status: 201 }),
);
const staffHistory = http.get('/api/v1/acr/staff/:userId', ({ params }) =>
  HttpResponse.json([acrAssessmentFactory({ user_id: params.userId as string })]),
);

export const acrHandlers = {
  listEmpty: http.get('/api/v1/acr/assessments', () => HttpResponse.json([])),
};

export const acrDefaultHandlers = [
  getCriteria,
  saveCriteria,
  listAssessments,
  startAssessment,
  getAssessment,
  patchAssessment,
  completeAssessment,
  reopenAssessment,
  staffHistory,
];
