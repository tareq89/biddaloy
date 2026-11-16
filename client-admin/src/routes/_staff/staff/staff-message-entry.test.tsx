import { Permission } from '@biddaloy/shared';
import {
  cleanupTestState,
  renderWithRouter,
  server,
  userEvent,
  userResponseFactory,
} from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [80.2.03] Negative case for the staff list's bulk "Send SMS": without STAFF_MESSAGE_SEND the
 * button is not offered. Only an Admin can open /staff, so the permission is taken away in the
 * hook (the positive case lives in `index.test.tsx`).
 */
const deny = vi.hoisted(() => ({ staffMessage: false }));
vi.mock('@biddaloy/ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/hooks')>();
  return {
    ...actual,
    useHasPermission: (p: Permission) =>
      !(deny.staffMessage && p === Permission.STAFF_MESSAGE_SEND) && actual.useHasPermission(p),
  };
});

afterEach(async () => {
  deny.staffMessage = false;
  await cleanupTestState();
});

const user1 = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function renderStaffList() {
  server.use(
    http.get('/api/v1/designations', () => HttpResponse.json([])),
    http.get('/api/v1/users', () =>
      HttpResponse.json({
        data: [userResponseFactory({ id: user1, full_name: 'Abdul Karim', role: 'TEACHER' })],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      }),
    ),
  );
  return renderWithRouter(routeTree, {
    initialEntries: ['/staff'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/staff bulk Send SMS permission [80.2.03]', () => {
  it('is hidden without STAFF_MESSAGE_SEND, while the other bulk actions still show', async () => {
    deny.staffMessage = true;
    renderStaffList();
    const user = userEvent.setup();
    await screen.findByText('Abdul Karim');
    await user.click(screen.getAllByRole('checkbox')[1]!);
    // The bar is up (a sibling bulk action shows), but there is no Send SMS.
    await screen.findByRole('button', { name: /^Print ID cards/ });
    expect(screen.queryByRole('button', { name: 'Send SMS' })).toBeNull();
  });
});
