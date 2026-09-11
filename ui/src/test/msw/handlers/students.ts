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

// [14.9.2]: the old single write-on-upload `POST /students/bulk-upload`
// route is gone (split into validate + commit, #605). These two handlers
// replace `bulkUpload`/`bulkUploadWithErrors`.
const bulkUploadValidate = http.post('/api/v1/students/bulk-upload/validate', () =>
  HttpResponse.json({
    staging_id: 'staging-clean',
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    rows_to_create: 3,
    preview: [
      {
        row: 2,
        student_name: 'Karim Rahman',
        class: 'Class 5',
        section: 'A',
        guardian1_phone: '+8801711111111',
      },
      {
        row: 3,
        student_name: 'Rahim Uddin',
        class: 'Class 5',
        section: 'A',
        guardian1_phone: '+8801711111112',
      },
      {
        row: 4,
        student_name: 'Fatema Begum',
        class: 'Class 5',
        section: 'B',
        guardian1_phone: '+8801711111113',
      },
    ],
    errors: [],
    hard_error_count: 0,
  }),
);

const bulkUploadValidateWithErrors = http.post('/api/v1/students/bulk-upload/validate', () =>
  HttpResponse.json({
    staging_id: 'staging-with-errors',
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    rows_to_create: 1,
    preview: [
      {
        row: 2,
        student_name: 'Karim Rahman',
        class: 'Class 5',
        section: 'A',
        guardian1_phone: '+8801711111111',
      },
    ],
    errors: [
      {
        row: 3,
        field: 'guardian1_phone',
        value: '০১৭১২৩৪৫৬৭',
        reason: 'Invalid phone format: guardian1_phone',
      },
      { row: 4, field: 'class', value: 'Class 99', reason: "Class 'Class 99' not found" },
    ],
    hard_error_count: 2,
  }),
);

const bulkUploadCommit = http.post('/api/v1/students/bulk-upload/commit', () =>
  HttpResponse.json({
    total_rows: 3,
    success_count: 3,
    error_count: 0,
    created_student_ids: [studentFactory().id, studentFactory().id, studentFactory().id],
    errors: [],
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
  bulkUploadValidate,
  bulkUploadValidateWithErrors,
  bulkUploadCommit,
};

export const studentDefaultHandlers = [
  list,
  mine,
  getOne,
  create,
  update,
  remove,
  bulkUploadValidate,
  bulkUploadCommit,
];
