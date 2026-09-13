import { FeeStatus, PeriodType } from '@biddaloy/shared';

import type { components } from '../../api/schema';

import { academicYearFactory } from './academic-year.factory';
import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { feeStructureFactory } from './fee-structure.factory';
import { moneyAmount } from './money';
import type { Script } from './script';
import { studentFactory } from './student.factory';

/** "Due" in the issue's language — a student's fee obligation for a period. */
export type StudentFee = components['schemas']['StudentFee'];

export function studentFeeFactory(
  overrides: Partial<StudentFee> = {},
  script?: Script,
): StudentFee {
  const student = overrides.student ?? studentFactory({}, script);
  const academicYear = overrides.academic_year ?? academicYearFactory({ tenant: student.tenant });
  const feeStructure =
    overrides.fee_structure ?? feeStructureFactory({ academic_year: academicYear });
  const totalAmount = overrides.total_amount ?? moneyAmount(4);
  const periodStart =
    overrides.period_start ??
    new Date(Date.UTC(new Date(academicYear.start_date).getUTCFullYear(), 0, 1)).toISOString();
  const periodDate = new Date(periodStart);
  return {
    id: faker.string.uuid(),
    student,
    student_id: student.id,
    academic_year: academicYear,
    academic_year_id: academicYear.id,
    fee_structure: feeStructure,
    fee_structure_id: feeStructure.id,
    fee_generation_id: null,
    period_start: periodStart,
    period_type: PeriodType.MONTH,
    occurrence: 1,
    month: periodDate.getUTCMonth() + 1,
    year: periodDate.getUTCFullYear(),
    total_amount: totalAmount,
    paid_amount: 0,
    discount_amount: 0,
    standing_discount_amount: 0,
    one_off_discount_amount: 0,
    status: FeeStatus.PENDING,
    due_date: faker.date.soon({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    reminder_threshold_date: null,
    approved_by_user_id: null,
    late_fee_for_student_fee_id: null,
    late_fee_for_student_fee: null,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    ...overrides,
  };
}
