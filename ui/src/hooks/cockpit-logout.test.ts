import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { afterEach, expect, it } from 'vitest';

import { configureSessionEndpoints } from '../api/session';
import { server } from '../test/msw/server';

import { logout } from './auth';

afterEach(() =>
  configureSessionEndpoints({
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    logoutAll: '/auth/logout-all',
  }),
);

it('logout() posts to /auth/cockpit/logout once the cockpit endpoints are configured', async () => {
  configureSessionEndpoints({
    refresh: '/auth/cockpit/refresh',
    logout: '/auth/cockpit/logout',
    logoutAll: '/auth/cockpit/logout-all',
  });
  const hits: string[] = [];
  server.use(
    http.post('*/auth/cockpit/logout', () => {
      hits.push('cockpit');
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('*/auth/logout', () => {
      hits.push('school');
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await logout(new QueryClient());
  expect(hits).toEqual(['cockpit']);
});
