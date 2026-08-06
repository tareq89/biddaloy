import { http, HttpResponse } from 'msw';

import { academicYearFactory, type AcademicYear } from '../../factories';
import { paginate } from '../support';

const fixtures: AcademicYear[] = [
  academicYearFactory({ is_current: true }),
  academicYearFactory(),
  academicYearFactory(),
];

const list = http.get('/api/v1/academic-years', ({ request }) =>
  HttpResponse.json(paginate(fixtures, request.url)),
);

const listEmpty = http.get('/api/v1/academic-years', ({ request }) =>
  HttpResponse.json(paginate([], request.url)),
);

const getOne = http.get('/api/v1/academic-years/:id', ({ params }) =>
  HttpResponse.json(academicYearFactory({ id: params.id as string })),
);

const create = http.post('/api/v1/academic-years', () =>
  HttpResponse.json(academicYearFactory(), { status: 201 }),
);

const update = http.patch('/api/v1/academic-years/:id', ({ params }) =>
  HttpResponse.json(academicYearFactory({ id: params.id as string })),
);

const remove = http.delete(
  '/api/v1/academic-years/:id',
  () => new HttpResponse(null, { status: 204 }),
);

const setCurrent = http.post('/api/v1/academic-years/:id/set-current', ({ params }) =>
  HttpResponse.json(academicYearFactory({ id: params.id as string, is_current: true })),
);

export const academicYearHandlers = {
  list,
  listEmpty,
  getOne,
  create,
  update,
  remove,
  setCurrent,
};

export const academicYearDefaultHandlers = [list, getOne, create, update, remove, setCurrent];
