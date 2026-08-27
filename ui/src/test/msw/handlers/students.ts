import { http, HttpResponse } from 'msw';

import { studentFactory, type Student } from '../../factories';
import { paginate } from '../support';

const fixtures: Student[] = [studentFactory(), studentFactory(), studentFactory()];

const list = http.get('/api/v1/students', ({ request }) =>
  HttpResponse.json(paginate(fixtures, request.url)),
);

const listEmpty = http.get('/api/v1/students', ({ request }) =>
  HttpResponse.json(paginate([], request.url)),
);

/** [5.1]'s family discovery route. Registered **before** `getOne` in the
 * defaults below — MSW matches in registration order, and
 * `/api/v1/students/:id` would otherwise swallow `/students/mine` and
 * answer it with a student whose id is the literal string "mine". */
const mine = http.get('/api/v1/students/mine', () => HttpResponse.json(fixtures.slice(0, 2)));

const mineEmpty = http.get('/api/v1/students/mine', () => HttpResponse.json([]));

const getOne = http.get('/api/v1/students/:id', ({ params }) =>
  HttpResponse.json(studentFactory({ id: params.id as string })),
);

const create = http.post('/api/v1/students', () =>
  HttpResponse.json(studentFactory(), { status: 201 }),
);

const update = http.patch('/api/v1/students/:id', ({ params }) =>
  HttpResponse.json(studentFactory({ id: params.id as string })),
);

const remove = http.delete('/api/v1/students/:id', () => new HttpResponse(null, { status: 204 }));

const bulkUpload = http.post('/api/v1/students/bulk-upload', () =>
  HttpResponse.json({
    total_rows: 3,
    success_count: 3,
    error_count: 0,
    created_student_ids: [studentFactory().id, studentFactory().id, studentFactory().id],
    errors: [],
  }),
);

const bulkUploadWithErrors = http.post('/api/v1/students/bulk-upload', () =>
  HttpResponse.json({
    total_rows: 3,
    success_count: 1,
    error_count: 2,
    created_student_ids: [studentFactory().id],
    errors: [
      {
        row: 2,
        field: 'guardian1_phone',
        value: '০১৭১২৩৪৫৬৭',
        reason: 'Invalid phone format: guardian1_phone',
      },
      { row: 3, field: 'class', value: 'Class 99', reason: "Class 'Class 99' not found" },
    ],
  }),
);

export const studentHandlers = {
  list,
  listEmpty,
  mine,
  mineEmpty,
  getOne,
  create,
  update,
  remove,
  bulkUpload,
  bulkUploadWithErrors,
};

export const studentDefaultHandlers = [list, mine, getOne, create, update, remove, bulkUpload];
