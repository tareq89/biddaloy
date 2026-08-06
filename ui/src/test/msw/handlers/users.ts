import { http, HttpResponse } from 'msw';

import { userResponseFactory, type UserResponseDto } from '../../factories';
import { paginate } from '../support';

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

const getOne = http.get('/api/v1/users/:id', ({ params }) =>
  HttpResponse.json(userResponseFactory({ id: params.id as string })),
);

const create = http.post('/api/v1/users', () =>
  HttpResponse.json(userResponseFactory(), { status: 201 }),
);

const update = http.patch('/api/v1/users/:id', ({ params }) =>
  HttpResponse.json(userResponseFactory({ id: params.id as string })),
);

const remove = http.delete('/api/v1/users/:id', () => new HttpResponse(null, { status: 204 }));

export const userHandlers = { list, listEmpty, getOne, create, update, remove };

export const userDefaultHandlers = [list, getOne, create, update, remove];
