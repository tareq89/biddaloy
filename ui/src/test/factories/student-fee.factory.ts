import { FeeStatus } from '@biddaloy/shared';

import type { components } from '../../api/schema';

import { academicYearFactory } from './academic-year.factory';
import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { moneyAmount } from './money';
import type { Script } from './script';
import { studentFactory } from './student.factory';

/** "Due" in the issue's language — a student's fee obligation for a month. */
export type StudentFee = components['schemas']['StudentFee'];

export function studentFeeFactory(
  overrides: Partial<StudentFee> = {},
  script?: Script,
): StudentFee {
  const student = overrides.student ?? studentFactory({}, script);
  const academicYear = overrides.academic_year ?? academicYearFactory({ tenant: student.tenant });
  const totalAmount = overrides.total_amount ?? moneyAmount(4);
  return {
    id: faker.string.uuid(),
    student,
    student_id: student.id,
    academic_year: academicYear,
    academic_year_id: academicYear.id,
    month: faker.number.int({ min: 1, max: 12 }),
    year: new Date(academicYear.start_date).getUTCFullYear(),
    total_amount: totalAmount,
    paid_amount: 0,
    discount_amount: 0,
    status: FeeStatus.PENDING,
    due_date: faker.date.soon({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    reminder_threshold_date: null,
    is_advance_payment: false,
    original_advance_month: null,
    original_advance_year: null,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    ...overrides,
  };
}
