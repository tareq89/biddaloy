import { FeeStatus, FeeType, PeriodType } from '@biddaloy/shared';

import type { components } from '../../api/schema';

import { academicYearFactory } from './academic-year.factory';
import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { feeStructureFactory } from './fee-structure.factory';
import { moneyAmount } from './money';
import type { Script } from './script';
import { studentFactory } from './student.factory';

/** [38.3.1] A logged fine — a `StudentFee` row with `fee_type: 'FINE'` plus
 * the fine-only fields (`note`, `incident_date`, `fine_rule_id`/`fine_rule`)
 * populated. Clone of `student-fee.factory.ts`'s `studentFeeFactory` with
 * those fine defaults, per the ticket's step 2. */
export type Fine = components['schemas']['StudentFee'];

export function fineFactory(overrides: Partial<Fine> = {}, script?: Script): Fine {
  const student = overrides.student ?? studentFactory({}, script);
  const academicYear = overrides.academic_year ?? academicYearFactory({ tenant: student.tenant });
  const feeStructure =
    overrides.fee_structure ??
    feeStructureFactory({ academic_year: academicYear, fee_type: FeeType.FINE });
  const totalAmount = overrides.total_amount ?? moneyAmount(4);
  const incidentDate =
    overrides.incident_date ?? faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString();
  const periodStart = overrides.period_start ?? incidentDate;
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
    note: 'Late arrival',
    incident_date: incidentDate,
    fine_rule_id: null,
    fine_rule: null,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
