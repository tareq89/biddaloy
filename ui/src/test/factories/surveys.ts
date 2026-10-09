import type {
  PendingSurvey,
  Survey,
  SurveyDetail,
  SurveyPairResult,
  SurveyResults,
} from '../../hooks/surveys';

import { faker } from './faker';

/** [28.4.1] Wire shapes for `/surveys` (entity snake_case; `mine` and `results` camelCase). */
export function surveyFactory(overrides: Partial<Survey> = {}): Survey {
  return {
    id: faker.string.uuid(),
    tenant_id: faker.string.uuid(),
    tenant: {} as Survey['tenant'],
    title: 'Term 2 teacher survey',
    status: 'DRAFT',
    anonymous: true,
    respondent: 'BOTH',
    opens_at: null,
    closes_at: null,
    min_responses: 3,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

export function surveyDetailFactory(overrides: Partial<SurveyDetail> = {}): SurveyDetail {
  const survey = surveyFactory();
  const surveyId = survey.id;
  return {
    id: surveyId,
    tenant_id: survey.tenant_id,
    title: survey.title,
    status: survey.status,
    anonymous: survey.anonymous,
    respondent: survey.respondent,
    opens_at: survey.opens_at,
    closes_at: survey.closes_at,
    min_responses: survey.min_responses,
    created_at: survey.created_at,
    updated_at: survey.updated_at,
    questions: [
      {
        id: faker.string.uuid(),
        tenant_id: survey.tenant_id,
        survey_id: surveyId,
        text: 'Explains clearly',
        stars_enabled: true,
        sort_order: 0,
      },
    ],
    targets: [
      {
        id: faker.string.uuid(),
        tenant_id: survey.tenant_id,
        survey_id: surveyId,
        teacher_id: faker.string.uuid(),
        subject_id: faker.string.uuid(),
      },
    ],
    ...overrides,
  };
}

export function pendingSurveyFactory(overrides: Partial<PendingSurvey> = {}): PendingSurvey {
  return {
    id: faker.string.uuid(),
    title: 'Term 2 teacher survey',
    anonymous: true,
    closesAt: null,
    questions: [{ id: faker.string.uuid(), text: 'Explains clearly', starsEnabled: true }],
    pending: [
      {
        teacherId: faker.string.uuid(),
        teacherName: 'Rahim Uddin',
        subjectId: faker.string.uuid(),
        subjectName: 'Mathematics',
        subjectNameBn: 'গণিত',
      },
    ],
    ...overrides,
  };
}

export function hiddenPairResultFactory(count = 1): SurveyPairResult {
  return { teacherId: faker.string.uuid(), subjectId: faker.string.uuid(), count, hidden: true };
}

export function surveyResultsFactory(overrides: Partial<SurveyResults> = {}): SurveyResults {
  return {
    surveyId: faker.string.uuid(),
    title: 'Term 2 teacher survey',
    anonymous: true,
    minResponses: 3,
    results: [hiddenPairResultFactory()],
    ...overrides,
  };
}
