import { http, HttpResponse } from 'msw';

import { guardianFactory, type Guardian } from '../../factories';
import { paginate } from '../support';

const fixtures: Guardian[] = [guardianFactory(), guardianFactory(), guardianFactory()];

const list = http.get('/api/v1/guardians', ({ request }) =>
  HttpResponse.json(paginate(fixtures, request.url)),
);

const listEmpty = http.get('/api/v1/guardians', ({ request }) =>
  HttpResponse.json(paginate([], request.url)),
);

const create = http.post('/api/v1/guardians', () =>
  HttpResponse.json(guardianFactory(), { status: 201 }),
);

/** [8.11.4]'s detail page. */
const getOne = http.get('/api/v1/guardians/:id', ({ params }) =>
  HttpResponse.json(guardianFactory({ id: params.id as string })),
);

const getOneNotFound = http.get('/api/v1/guardians/:id', () =>
  HttpResponse.json({ message: 'Guardian not found', statusCode: 404 }, { status: 404 }),
);

const update = http.patch('/api/v1/guardians/:id', ({ params }) =>
  HttpResponse.json(guardianFactory({ id: params.id as string })),
);

const remove = http.delete('/api/v1/guardians/:id', () => new HttpResponse(null, { status: 204 }));

export const guardianHandlers = {
  list,
  listEmpty,
  create,
  getOne,
  getOneNotFound,
  update,
  remove,
};

export const guardianDefaultHandlers = [list, create, getOne, update, remove];
