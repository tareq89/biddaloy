import { FeeStatus } from '@biddaloy/shared';
import { http, HttpResponse } from 'msw';

import type { FeeDueEntry, FeeDueRow } from '../../../hooks/fee-dues';
import { feeStructureFactory, studentFactory, type FeeStructure } from '../../factories';
import { faker, FACTORY_REFERENCE_DATE } from '../../factories/faker';
import { moneyAmount } from '../../factories/money';
import { paginate } from '../support';

const structureFixtures: FeeStructure[] = [
  feeStructureFactory(),
  feeStructureFactory(),
  feeStructureFactory(),
];

const listStructures = http.get('/api/v1/fee-structures', ({ request }) =>
  HttpResponse.json(paginate(structureFixtures, request.url)),
);

const listStructuresEmpty = http.get('/api/v1/fee-structures', ({ request }) =>
  HttpResponse.json(paginate([], request.url)),
);

const getStructure = http.get('/api/v1/fee-structures/:id', ({ params }) =>
  HttpResponse.json(feeStructureFactory({ id: params.id as string })),
);

const createStructure = http.post('/api/v1/fee-structures', () =>
  HttpResponse.json(feeStructureFactory(), { status: 201 }),
);

const updateStructure = http.patch('/api/v1/fee-structures/:id', ({ params }) =>
  HttpResponse.json(feeStructureFactory({ id: params.id as string })),
);

const removeStructure = http.delete(
  '/api/v1/fee-structures/:id',
  () => new HttpResponse(null, { status: 204 }),
);

/** [8.10.4]'s dues queue — `FeeDuesService.getDues`/`getFlaggedDues`'s
 * actual response shape (`server/src/modules/fees/fee-dues.service.ts`),
 * not a bare `StudentFee` the endpoint's own name might suggest. Inline,
 * not a dedicated factory file — same precedent `payments.ts`'s
 * `listInvoicesByStudent` sets for a hand-typed (no generated schema)
 * response shape. */
function dueEntryFixture(overrides: Partial<FeeDueEntry> = {}): FeeDueEntry {
  const totalAmount = overrides.total_amount ?? moneyAmount(4);
  const paidAmount = overrides.paid_amount ?? 0;
  const discountAmount = overrides.discount_amount ?? 0;
  return {
    student_fee_id: faker.string.uuid(),
    month: faker.number.int({ min: 1, max: 12 }),
    year: 2026,
    total_amount: totalAmount,
    paid_amount: paidAmount,
    discount_amount: discountAmount,
    balance: totalAmount - paidAmount - discountAmount,
    status: FeeStatus.PENDING,
    due_date: faker.date.soon({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    reminder_threshold_date: null,
    ...overrides,
  };
}

function feeDueRowFixture(overrides: Partial<FeeDueRow> = {}): FeeDueRow {
  const student = studentFactory();
  const dues = overrides.dues ?? [dueEntryFixture()];
  return {
    student_id: student.id,
    full_name: student.full_name,
    registration_number: student.registration_number,
    roll_number: student.roll_number,
    class_name: student.class_section.class.name,
    section_name: student.class_section.section_name,
    total_due: dues.reduce((sum, due) => sum + due.balance, 0),
    months_overdue: 0,
    dues,
    ...overrides,
  };
}

const dueFixtures: FeeDueRow[] = [feeDueRowFixture(), feeDueRowFixture(), feeDueRowFixture()];

const dues = http.get('/api/v1/fees/dues', ({ request }) =>
  HttpResponse.json(paginate(dueFixtures, request.url)),
);

const duesEmpty = http.get('/api/v1/fees/dues', ({ request }) =>
  HttpResponse.json(paginate([], request.url)),
);

const flaggedDues = http.get('/api/v1/fees/dues/flagged', ({ request }) =>
  HttpResponse.json(paginate(dueFixtures.slice(0, 1), request.url)),
);

const generate = http.post('/api/v1/fees/generate', () =>
  HttpResponse.json({ generated: 42, skipped: 3, students_evaluated: 45 }, { status: 201 }),
);

/** [8.11.6] — the re-run case: every student already has a fee record for
 * the chosen period, so `ON CONFLICT DO NOTHING` skips all of them and
 * nothing is generated. Still a 201 success, not an error, which is
 * exactly what the wizard's summary screen has to make readable. */
const generateAllSkipped = http.post('/api/v1/fees/generate', () =>
  HttpResponse.json({ generated: 0, skipped: 42, students_evaluated: 42 }, { status: 201 }),
);

export const feeStructureHandlers = {
  list: listStructures,
  listEmpty: listStructuresEmpty,
  getOne: getStructure,
  create: createStructure,
  update: updateStructure,
  remove: removeStructure,
};

export const feeStructureDefaultHandlers = [
  listStructures,
  getStructure,
  createStructure,
  updateStructure,
  removeStructure,
];

export const feeHandlers = { dues, duesEmpty, flaggedDues, generate, generateAllSkipped };

export const feeDefaultHandlers = [dues, flaggedDues, generate];
