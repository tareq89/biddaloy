import { http, HttpResponse } from 'msw';

import { guardianFactory, type Guardian } from '../../factories';
import { apiErrorBody, paginate } from '../support';

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

/** `GET`/`PATCH /guardians/mine` — [8.14.4]'s Account page guardian-contact
 * card, PARENT-only. Registered **before** `getOne`/`update`
 * (`/api/v1/guardians/:id`) — MSW matches handlers in registration order,
 * and `:id` would otherwise swallow the literal path segment `"mine"` too,
 * mirroring `students.controller.ts`'s own declaration-order constraint
 * server-side. */
const getMine = http.get('/api/v1/guardians/mine', () => HttpResponse.json(guardianFactory()));

const updateMine = http.patch('/api/v1/guardians/mine', async ({ request }) => {
  const body = (await request.json()) as Partial<Guardian>;
  return HttpResponse.json(guardianFactory(body));
});

/** [8.14.4] plan correction 2 — the BD-only phone regex rejection, surfaced
 * as a 400 from `ValidationPipe`. */
const updateMineInvalidPhone = http.patch('/api/v1/guardians/mine', () =>
  HttpResponse.json(
    apiErrorBody(400, 'phone must match /^(?:\\+?880|0)1[3-9]\\d{8}$/', '/api/v1/guardians/mine'),
    { status: 400 },
  ),
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
  getMine,
  updateMine,
  updateMineInvalidPhone,
  getOne,
  getOneNotFound,
  update,
  remove,
};

export const guardianDefaultHandlers = [list, create, getMine, updateMine, getOne, update, remove];
