import { http, HttpResponse } from 'msw';

import {
  feeStructureFactory,
  studentFeeFactory,
  type FeeStructure,
  type StudentFee,
} from '../../factories';
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

const dueFixtures: StudentFee[] = [studentFeeFactory(), studentFeeFactory(), studentFeeFactory()];

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

export const feeHandlers = { dues, duesEmpty, flaggedDues, generate };

export const feeDefaultHandlers = [dues, flaggedDues, generate];
