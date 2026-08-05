import type { components } from '../../api/schema';

import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { schoolFactory } from './school.factory';

export type AcademicYear = components['schemas']['AcademicYear'];

export function academicYearFactory(overrides: Partial<AcademicYear> = {}): AcademicYear {
  // UTC throughout — `getFullYear()`/`new Date(y, m, d)` read/construct in
  // the host time zone, so the same seed would produce a different year (or
  // a shifted ISO string) depending on which machine runs the test.
  const year = faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).getUTCFullYear();
  const tenant = overrides.tenant ?? schoolFactory();
  return {
    id: faker.string.uuid(),
    name: `${year}-${year + 1}`,
    start_date: new Date(Date.UTC(year, 0, 1)).toISOString(),
    end_date: new Date(Date.UTC(year, 11, 31)).toISOString(),
    is_current: false,
    tenant,
    tenant_id: tenant.id,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
