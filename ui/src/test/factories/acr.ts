import type { AcrAssessment, AcrCriterion } from '../../hooks/acr';
import type { Incident } from '../../hooks/incidents';

import { FACTORY_REFERENCE_DATE, faker } from './faker';

/** [28.3.1] Wire shapes from the generated schema (ACR snake_case, incident camelCase). */
export function acrCriterionFactory(overrides: Partial<AcrCriterion> = {}): AcrCriterion {
  return {
    id: faker.string.uuid(),
    block: 'BLOCK_2',
    code: faker.string.alpha(6).toUpperCase(),
    label_en: 'Punctuality',
    label_bn: 'সময়ানুবর্তিতা',
    sort_order: 1,
    ...overrides,
  };
}

export function acrAssessmentFactory(overrides: Partial<AcrAssessment> = {}): AcrAssessment {
  return {
    id: faker.string.uuid(),
    user_id: faker.string.uuid(),
    academic_year_id: faker.string.uuid(),
    form_version_id: faker.string.uuid(),
    status: 'INCOMPLETE',
    total: null,
    assessed_by: faker.string.uuid(),
    step1_data: null,
    step3_data: null,
    completed_at: null,
    scores: [],
    ...overrides,
  };
}

export function incidentFactory(overrides: Partial<Incident> = {}): Incident {
  const occurred = faker.date.recent({ refDate: FACTORY_REFERENCE_DATE });
  return {
    id: faker.string.uuid(),
    staffId: faker.string.uuid(),
    type: 'BEHAVIOUR',
    severity: 'LOW',
    occurredOn: occurred.toISOString().slice(0, 10),
    description: 'Late to assembly',
    createdAt: occurred.toISOString(),
    ...overrides,
  };
}
