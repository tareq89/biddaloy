import { http, HttpResponse } from 'msw';

import type { FineRule } from '../../../hooks/fines';
import { academicYearFactory, fineFactory, type Fine } from '../../factories';
import { faker } from '../../factories/faker';

/** [38.3.1] `GET/POST/PATCH/DELETE /fees/fine-rules` fixtures — `FineRuleDto`
 * is untyped in `../../factories` (no dedicated factory file per the
 * ticket's file list), so it's built inline here, same precedent
 * `handlers/fees.ts`'s `dueEntryFixture` sets for a hand-typed shape. */
function fineRuleFixture(overrides: Partial<FineRule> = {}): FineRule {
  const academicYear = academicYearFactory();
  return {
    id: faker.string.uuid(),
    academic_year_id: academicYear.id,
    trigger: 'ATTENDANCE_ABSENT',
    fee_structure_id: faker.string.uuid(),
    fee_structure_name: 'Absence fine',
    fee_structure_amount: 50,
    class_id: null,
    class_name: null,
    free_per_period: 2,
    cap_per_period: null,
    conditions: {},
    is_active: true,
    created_by_user_id: null,
    created_at: faker.date.past().toISOString(),
    updated_at: faker.date.recent().toISOString(),
    ...overrides,
  };
}

const ruleFixtures: FineRule[] = [
  fineRuleFixture(),
  fineRuleFixture({ trigger: 'ATTENDANCE_LATE' }),
];

const listFineRules = http.get('/api/v1/fees/fine-rules', () => HttpResponse.json(ruleFixtures));

const createFineRule = http.post('/api/v1/fees/fine-rules', () =>
  HttpResponse.json(fineRuleFixture(), { status: 201 }),
);

const updateFineRule = http.patch('/api/v1/fees/fine-rules/:id', ({ params }) =>
  HttpResponse.json(fineRuleFixture({ id: params.id as string })),
);

const removeFineRule = http.delete(
  '/api/v1/fees/fine-rules/:id',
  () => new HttpResponse(null, { status: 200 }),
);

const copyFineRules = http.post(
  '/api/v1/fees/fine-rules/copy',
  () => new HttpResponse(null, { status: 201 }),
);

/** `GET /fees/fines`'s 200 body — untyped in `schema.d.ts`, see
 * `hooks/fines.ts`'s `PaginatedFines` comment for why this is hand-typed
 * against the ticket's `{ items, total, totals }` contract. */
const fineFixtures: Fine[] = [fineFactory(), fineFactory(), fineFactory()];

function finesTotals(fines: Fine[]) {
  const charged = fines.reduce((sum, fine) => sum + fine.total_amount, 0);
  const collected = fines.reduce((sum, fine) => sum + fine.paid_amount, 0);
  const waived = fines.reduce((sum, fine) => sum + fine.discount_amount, 0);
  const outstanding = fines.reduce(
    (sum, fine) => sum + fine.total_amount - fine.discount_amount - fine.paid_amount,
    0,
  );
  return { charged, collected, waived, outstanding };
}

const listFines = http.get('/api/v1/fees/fines', () =>
  HttpResponse.json({
    items: fineFixtures,
    total: fineFixtures.length,
    totals: finesTotals(fineFixtures),
  }),
);

const listFinesEmpty = http.get('/api/v1/fees/fines', () =>
  HttpResponse.json({
    items: [],
    total: 0,
    totals: { charged: 0, collected: 0, waived: 0, outstanding: 0 },
  }),
);

const logFine = http.post('/api/v1/fees/fines', () =>
  HttpResponse.json({ bill_ids: [faker.string.uuid()] }, { status: 201 }),
);

const waiveFine = http.post('/api/v1/fees/fines/:id/waive', ({ params }) =>
  HttpResponse.json({ id: params.id as string, amount: 100, status: 'WAIVED' }, { status: 201 }),
);

const previewFineGeneration = http.post('/api/v1/fees/fines/generate/preview', () =>
  HttpResponse.json(
    { students: [], total_amount: 0, would_create: 0, duplicates: [] },
    { status: 201 },
  ),
);

const generateFines = http.post('/api/v1/fees/fines/generate', () =>
  HttpResponse.json(
    { fee_generation_ids: [faker.string.uuid()], generated_count: 1, skipped_count: 0 },
    { status: 201 },
  ),
);

export const fineHandlers = {
  listRules: listFineRules,
  createRule: createFineRule,
  updateRule: updateFineRule,
  removeRule: removeFineRule,
  copyRules: copyFineRules,
  list: listFines,
  listEmpty: listFinesEmpty,
  log: logFine,
  waive: waiveFine,
  preview: previewFineGeneration,
  generate: generateFines,
};

export const fineDefaultHandlers = [
  listFineRules,
  createFineRule,
  updateFineRule,
  removeFineRule,
  copyFineRules,
  listFines,
  logFine,
  waiveFine,
  previewFineGeneration,
  generateFines,
];
