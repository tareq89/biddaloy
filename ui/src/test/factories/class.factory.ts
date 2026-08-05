import type { components } from '../../api/schema';

import { academicYearFactory } from './academic-year.factory';
import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { schoolFactory } from './school.factory';

export type Class = components['schemas']['Class'];

// Default `sections: []` — `ClassSection.class` points back at a `Class`,
// and a factory-built `Class` never carries real `ClassSection` objects by
// default so the two never recurse into each other. Pass real sections in
// via overrides when a test needs them populated.
export function classFactory(overrides: Partial<Class> = {}): Class {
  const academicYear = overrides.academic_year ?? academicYearFactory();
  const tenant = overrides.tenant ?? academicYear.tenant ?? schoolFactory();
  return {
    id: faker.string.uuid(),
    name: `Class ${faker.number.int({ min: 1, max: 12 })}`,
    numeric_grade: faker.number.int({ min: 1, max: 12 }),
    academic_year: academicYear,
    academic_year_id: academicYear.id,
    tenant,
    tenant_id: tenant.id,
    sections: [],
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
