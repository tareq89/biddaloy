import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const csv = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@biddaloy/ui/hooks', async (orig) => ({
  ...(await orig<typeof import('@biddaloy/ui/hooks')>()),
  downloadMoneyCsv: csv,
}));

afterEach(async () => {
  csv.mockClear();
  await cleanupTestState();
});

const render = (url = '/money') =>
  renderWithRouter(routeTree, {
    initialEntries: [url],
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    locale: 'en',
  });

describe('/money', () => {
  it('is the SMS state tab: what to do first, then the schools, with the record button', async () => {
    render();
    expect(await screen.findByRole('region', { name: 'What to do' })).toBeTruthy();
    expect(await screen.findByText('Rose Valley School')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Record SMS bought' }).length).toBeGreaterThan(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Money' })).toBeTruthy();
  });

  it('downloads the CSV through the helper, once', async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: 'Download CSV' }));
    expect(csv).toHaveBeenCalledTimes(1);
    expect(csv).toHaveBeenCalledWith('/platform/money/sms?format=csv', {}, 'sms-state.csv');
  });
});
