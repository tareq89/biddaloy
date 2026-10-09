import { FeeStatus, FeeType } from '@biddaloy/shared';

import type { Fine as FineDto } from '../../hooks/fines';

import { academicYearFactory } from './academic-year.factory';
import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { feeStructureFactory } from './fee-structure.factory';
import { moneyAmount } from './money';
import type { Script } from './script';
import { studentFactory } from './student.factory';

/** [38.3.1] A logged fine as `GET /fees/fines` returns it (`StaffFineDto`). */
export type Fine = FineDto;

export function fineFactory(overrides: Partial<Fine> = {}, script?: Script): Fine {
  const student = studentFactory({}, script);
  const feeStructure = feeStructureFactory({
    academic_year: academicYearFactory({ tenant: student.tenant }),
    fee_type: FeeType.FINE,
  });
  const incidentDate =
    overrides.incident_date ?? faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString();
  return {
    id: faker.string.uuid(),
    student_id: student.id,
    student_name: student.full_name,
    fee_structure_id: feeStructure.id,
    fee_name: feeStructure.name,
    note: 'Late arrival',
    incident_date: incidentDate,
    period_start: incidentDate,
    total_amount: moneyAmount(4),
    discount_amount: 0,
    paid_amount: 0,
    status: FeeStatus.PENDING,
    due_date: faker.date.soon({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    origin: 'MANUAL',
    approved_by_user_id: null,
    ...overrides,
  };
}
