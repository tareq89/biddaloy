import { Permission } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [80.2.03] Negative case for the Notify teachers dialog: without STAFF_MESSAGE_COORDINATED
 * there is no "Send as SMS" button, while the in-app "Send" stays. Only a Teacher opens this
 * page and a Teacher holds the permission, so it is taken away in the hook (the positive case
 * lives in `index.test.tsx`).
 */
const deny = vi.hoisted(() => ({ sms: false }));
vi.mock('@biddaloy/ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/hooks')>();
  return {
    ...actual,
    useHasPermission: (p: Permission) =>
      !(deny.sms && p === Permission.STAFF_MESSAGE_COORDINATED) && actual.useHasPermission(p),
  };
});

afterEach(async () => {
  deny.sms = false;
  await cleanupTestState();
});

const classX = {
  class_id: 'k6',
  class_name: 'Class 6',
  subject_id: null,
  subject_name: null,
  sections: [],
  pending_grids: [],
  teachers: [
    {
      user_id: 'u-maths',
      teacher_id: 't-maths',
      full_name: 'Maths Teacher',
      section_names: ['A'],
      subject_names: ['Mathematics'],
    },
  ],
};

describe('Notify teachers: Send as SMS permission [80.2.03]', () => {
  it('is hidden without STAFF_MESSAGE_COORDINATED, and the in-app Send stays', async () => {
    deny.sms = true;
    server.use(
      http.get('/api/v1/coordination/overview', () =>
        HttpResponse.json({ date: '2026-10-20', classes: [classX] }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/my-coordination?then=notify'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });
    const dialog = await screen.findByRole('dialog', { name: 'Notify teachers' });
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Send as SMS' })).toBeNull();
  });
});
