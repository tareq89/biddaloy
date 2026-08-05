import type { components } from '../../api/schema';

import { classFactory } from './class.factory';
import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { schoolFactory } from './school.factory';

export type ClassSection = components['schemas']['ClassSection'];

const SECTION_NAMES = ['A', 'B', 'C', 'D'] as const;

export function classSectionFactory(overrides: Partial<ClassSection> = {}): ClassSection {
  const klass = overrides.class ?? classFactory();
  const tenant = overrides.tenant ?? klass.tenant ?? schoolFactory();
  return {
    id: faker.string.uuid(),
    class: klass,
    class_id: klass.id,
    section_name: faker.helpers.arrayElement(SECTION_NAMES),
    capacity: faker.number.int({ min: 20, max: 60 }),
    tenant,
    tenant_id: tenant.id,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
