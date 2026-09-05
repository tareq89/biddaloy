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

/** `PATCH /users/me` — [8.14.4]'s Account page profile card. Registered
 * **before** `update` (`/api/v1/users/:id`) for the same "`:id` matches
 * the literal string `me` too" reason `getMe` documents above. */
const updateMe = http.patch('/api/v1/users/me', async ({ request }) => {
  const requestBody = (await request.json()) as Partial<
    UserResponseDto & { current_password: string }
  >;
  // `current_password` is a write-only proof of possession, never echoed
  // back — `UpdateOwnProfileDto`'s other fields overlay onto the base
  // fixture the same way the real `UserResponseDto` the server returns
  // would reflect exactly what was accepted. Only the fields actually
  // present in the request overlay the base fixture — a partial edit
  // (e.g. `full_name` only) must not blank out `email`/`phone` on the
  // response the way spreading an object with explicit `undefined` values
  // would.
  const body: Partial<UserResponseDto> = {};
  for (const [key, value] of Object.entries(requestBody)) {
    if (key !== 'current_password' && value !== undefined) {
      (body as Record<string, unknown>)[key] = value;
    }
  }
  return HttpResponse.json(userResponseFactory(body));
});

/** The 403 `UserController.updateMe` throws when `current_password` is
 * wrong (email/phone was changing) — [8.14.4] plan correction 4. */
const updateMeWrongPassword = http.patch('/api/v1/users/me', () =>
  HttpResponse.json(apiErrorBody(403, 'current_password is incorrect', '/api/v1/users/me'), {
    status: 403,
  }),
);

/** The 409 `UserController.updateMe` throws when the new email/phone is
 * already in use by another account. */
const updateMeConflict = http.patch('/api/v1/users/me', () =>
  HttpResponse.json(apiErrorBody(409, 'email is already in use', '/api/v1/users/me'), {
    status: 409,
  }),
);

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

/** [12.1] `POST /users/:id/invitation/resend` — re-issues an invitation link. */
const resendInvitation = http.post('/api/v1/users/:id/invitation/resend', () =>
  HttpResponse.json({
    status: 'SENT',
    medium: 'EMAIL',
    expires_at: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
  }),
);

/** [12.1] `DELETE /users/:id/invitation` — revokes any live invitation. */
const revokeInvitation = http.delete(
  '/api/v1/users/:id/invitation',
  () => new HttpResponse(null, { status: 204 }),
);

/** [12.3/#396] `POST /users/:id/reset-password` — admin-initiated reset. */
const adminResetPassword = http.post('/api/v1/users/:id/reset-password', () =>
  HttpResponse.json({
    channel: 'SMS',
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  }),
);

/** [12.4] `RecoveryService.adminReset`'s 400 for a target with neither a
 * phone nor an email on file — the one 400 this route can return. */
const adminResetPasswordNoContact = http.post('/api/v1/users/:id/reset-password', () =>
  HttpResponse.json(
    apiErrorBody(
      400,
      'This user has no phone or email on file',
      '/api/v1/users/:id/reset-password',
    ),
    { status: 400 },
  ),
);

export const userHandlers = {
  list,
  listEmpty,
  getMe,
  updateMe,
  updateMeWrongPassword,
  updateMeConflict,
  getOne,
  create,
  createConflict,
  update,
  remove,
  removeSelfBlocked,
  resendInvitation,
  revokeInvitation,
  adminResetPassword,
  adminResetPasswordNoContact,
};

export const userDefaultHandlers = [
  list,
  getMe,
  updateMe,
  getOne,
  create,
  update,
  remove,
  resendInvitation,
  revokeInvitation,
  adminResetPassword,
];
