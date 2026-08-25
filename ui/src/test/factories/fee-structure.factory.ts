import { FeeApplicability, FeeType } from '@biddaloy/shared';

import type { components } from '../../api/schema';

import { academicYearFactory } from './academic-year.factory';
import { classFactory } from './class.factory';
import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { moneyAmount } from './money';
import { schoolFactory } from './school.factory';
import { pickScript, type Script } from './script';
import { studentFactory } from './student.factory';

export type FeeStructure = components['schemas']['FeeStructure'];
export type FeeStructureStudent = components['schemas']['FeeStructureStudent'];

/** Fee names are free text the school types itself, so a Bangla-medium
 * tenant's list is full of Bangla-script names. Keyed by script so a test
 * can force either side rather than depending on `pickScript`'s coin flip. */
const FEE_NAME_BY_SCRIPT: Record<Script, string> = {
  latin: 'Monthly Tuition Fee',
  bn: 'মাসিক বেতন',
};

export function feeStructureFactory(
  overrides: Partial<FeeStructure> = {},
  script: Script = pickScript(),
): FeeStructure {
  const academicYear = overrides.academic_year ?? academicYearFactory();
  const klass = overrides.class ?? classFactory({ academic_year: academicYear });
  const tenant = overrides.tenant ?? klass.tenant ?? schoolFactory();
  return {
    id: faker.string.uuid(),
    fee_type: FeeType.MONTHLY_TUITION,
    name: FEE_NAME_BY_SCRIPT[pickScript(script)],
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

/** Pivot row as `GET /fee-structures/:id` serializes it: `student` hydrated,
 * `fee_structure` absent (the server never joins back to the parent it
 * already has). */
export function feeStructureStudentFactory(
  overrides: Partial<FeeStructureStudent> = {},
): FeeStructureStudent {
  const student = overrides.student ?? studentFactory();
  return {
    id: faker.string.uuid(),
    student,
    student_id: student.id,
    fee_structure_id: faker.string.uuid(),
    ...overrides,
  };
}
