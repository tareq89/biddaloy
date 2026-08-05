import { FeeApplicability, FeeType } from '@beton-boi/shared';

import type { components } from '../../api/schema';

import { academicYearFactory } from './academic-year.factory';
import { classFactory } from './class.factory';
import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { moneyAmount } from './money';
import { schoolFactory } from './school.factory';

export type FeeStructure = components['schemas']['FeeStructure'];

export function feeStructureFactory(overrides: Partial<FeeStructure> = {}): FeeStructure {
  const academicYear = overrides.academic_year ?? academicYearFactory();
  const klass = overrides.class ?? classFactory({ academic_year: academicYear });
  const tenant = overrides.tenant ?? klass.tenant ?? schoolFactory();
  return {
    id: faker.string.uuid(),
    fee_type: FeeType.MONTHLY_TUITION,
    name: 'Monthly Tuition Fee',
    amount: moneyAmount(4),
    applicability: FeeApplicability.ALL,
    class: klass,
    class_id: klass.id,
    section: null,
    section_id: null,
    academic_year: academicYear,
    academic_year_id: academicYear.id,
    month: faker.number.int({ min: 1, max: 12 }),
    is_recurring: true,
    tenant,
    tenant_id: tenant.id,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
