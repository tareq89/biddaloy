import { http, HttpResponse } from 'msw';

import { teacherFactory, type Teacher } from '../../factories';
import { paginate } from '../support';

const fixtures: Teacher[] = [teacherFactory(), teacherFactory(), teacherFactory()];

const list = http.get('/api/v1/teachers', ({ request }) =>
  HttpResponse.json(paginate(fixtures, request.url)),
);

const listEmpty = http.get('/api/v1/teachers', ({ request }) =>
  HttpResponse.json(paginate([], request.url)),
);

const create = http.post('/api/v1/teachers', () =>
  HttpResponse.json(teacherFactory(), { status: 201 }),
);

const update = http.patch('/api/v1/teachers/:id', ({ params }) =>
  HttpResponse.json(teacherFactory({ id: params.id as string })),
);

export const teacherHandlers = { list, listEmpty, create, update };

export const teacherDefaultHandlers = [list, create, update];
