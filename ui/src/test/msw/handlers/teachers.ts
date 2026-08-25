import { http, HttpResponse } from 'msw';

import { teacherFactory, type Teacher } from '../../factories';
import { apiErrorBody, paginate } from '../support';

const fixtures: Teacher[] = [teacherFactory(), teacherFactory(), teacherFactory()];

/** Like every default list handler, filters are ignored — the happy-path
 * baseline returns the fixtures regardless (`handlers.ts`'s own header:
 * a test asserting filter behaviour overrides with `server.use(...)`).
 * `user_id` in particular must not filter here: `global-search.test.tsx`
 * and [8.11.8]'s profile tab both hit this default with params that would
 * never match random fixtures. */
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

/** 409 — `employee_id` already exists. Globally unique (across every
 * tenant), so the message deliberately doesn't say "in this school". */
const createConflict = http.post('/api/v1/teachers', () =>
  HttpResponse.json(
    apiErrorBody(409, 'A teacher with this employee ID already exists', '/api/v1/teachers'),
    {
      status: 409,
    },
  ),
);

/** 400 — `user_id` isn't a member of the active tenant. */
const createNotMember = http.post('/api/v1/teachers', () =>
  HttpResponse.json(apiErrorBody(400, 'User is not a member of this school', '/api/v1/teachers'), {
    status: 400,
  }),
);

export const teacherHandlers = { list, listEmpty, create, createConflict, createNotMember, update };

export const teacherDefaultHandlers = [list, create, update];
