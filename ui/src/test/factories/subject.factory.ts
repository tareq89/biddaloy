import type { components } from '../../api/schema';

import { faker, FACTORY_REFERENCE_DATE } from './faker';
import { schoolFactory } from './school.factory';

export type Subject = components['schemas']['Subject'];

const SUBJECT_NAMES = ['Mathematics', 'Bangla', 'English', 'Science', 'Social Science'] as const;

export function subjectFactory(overrides: Partial<Subject> = {}): Subject {
  const tenant = overrides.tenant ?? schoolFactory();
  const nameEn = overrides.name_en ?? faker.helpers.arrayElement(SUBJECT_NAMES);
  return {
    id: faker.string.uuid(),
    tenant,
    tenant_id: tenant.id,
    name_en: nameEn,
    name_bn: null,
    code: nameEn.slice(0, 4).toUpperCase(),
    is_active: true,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
