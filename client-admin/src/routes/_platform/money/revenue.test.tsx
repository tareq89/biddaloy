import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

afterEach(async () => {
  await cleanupTestState();
});

const report = (month: string) => ({
  month,
  seat_income_paisa: 1_000_000,
  package_income_paisa: 100_000,
  refunds_paisa: 0,
  net_paisa: 1_100_000,
  paying_schools: 7,
  not_renewed: { items: [], next_cursor: null },
});

describe('/money/revenue month', () => {
  it('a month change lands in the URL and the report is fetched again for that month', async () => {
    const asked: (string | null)[] = [];
    server.use(
      http.get('*/platform/money/revenue', ({ request }) => {
        const month = new URL(request.url).searchParams.get('month');
        asked.push(month);
        return HttpResponse.json(report(month ?? '2029-12'));
      }),
    );
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/money/revenue?month=2029-11'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });
    expect(await screen.findByText('From seats')).toBeTruthy();
    expect(asked).toEqual(['2029-11']);

    await router.navigate({ to: '/money/revenue', search: { month: '2029-10' } });
    await expect.poll(() => router.state.location.search).toEqual({ month: '2029-10' });
    await expect.poll(() => asked).toEqual(['2029-11', '2029-10']);
  });
});
