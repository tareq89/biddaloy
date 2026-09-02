import { http, HttpResponse } from 'msw';

import { userResponseFactory, type UserResponseDto } from '../../factories';
import { faker } from '../../factories/faker';
import { apiErrorBody, paginate } from '../support';

const fixtures: UserResponseDto[] = [
  userResponseFactory(),
  userResponseFactory(),
  userResponseFactory(),
];

const list = http.get('/api/v1/users', ({ request }) =>
  HttpResponse.json(paginate(fixtures, request.url)),
);

const listEmpty = http.get('/api/v1/users', ({ request }) =>
  HttpResponse.json(paginate([], request.url)),
);

/** `GET /users/me` — [8.14.2]'s `useCurrentUser`. Registered **before**
 * `getOne` in `userDefaultHandlers` below: MSW matches path handlers in
 * registration order, and `/api/v1/users/:id` would otherwise swallow
 * `/api/v1/users/me` too (`:id` matches the literal string `"me"` just
 * fine). */
const getMe = http.get('/api/v1/users/me', () => HttpResponse.json(userResponseFactory()));

const getOne = http.get('/api/v1/users/:id', ({ params }) =>
  HttpResponse.json(userResponseFactory({ id: params.id as string })),
);

/** `POST /users` returns the created user **plus** the membership row the
 * server creates in the same transaction (`UserController.createUser`). */
const create = http.post('/api/v1/users', () => {
  const user = userResponseFactory();
  return HttpResponse.json(
    {
      user,
      membership: {
        id: faker.string.uuid(),
        role: user.role,
        tenant_id: faker.string.uuid(),
        user_id: user.id,
      },
    },
    { status: 201 },
  );
});

/** 409 duplicate email — `UserService.create`'s ConflictException. */
const createConflict = http.post('/api/v1/users', () =>
  HttpResponse.json(apiErrorBody(409, 'A user with this email already exists', '/api/v1/users'), {
    status: 409,
  }),
);

const update = http.patch('/api/v1/users/:id', ({ params }) =>
  HttpResponse.json(userResponseFactory({ id: params.id as string })),
);

const remove = http.delete('/api/v1/users/:id', () => new HttpResponse(null, { status: 204 }));

/** `UserService.remove`'s self-removal guard — the trust boundary behind
 * [8.11.8]'s disabled "remove yourself" action. */
const removeSelfBlocked = http.delete('/api/v1/users/:id', () =>
  HttpResponse.json(
    apiErrorBody(400, 'You cannot remove your own account from this school', '/api/v1/users'),
    {
      status: 400,
    },
  ),
);

export const userHandlers = {
  list,
  listEmpty,
  getMe,
  getOne,
  create,
  createConflict,
  update,
  remove,
  removeSelfBlocked,
};

export const userDefaultHandlers = [list, getMe, getOne, create, update, remove];
