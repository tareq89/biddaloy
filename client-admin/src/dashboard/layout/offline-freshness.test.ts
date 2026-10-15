import { getFreshness } from '@biddaloy/ui/api';
import axios from 'axios';
import { describe, expect, it } from 'vitest';

import { SW_CACHED_AT_HEADER } from '../../pwa/cache-policy';

import { installDashboardFreshness } from './offline-freshness';

const key = ['dashboard', 'widget', 'collection-month'];

function client(headers: Record<string, string> = {}) {
  const c = axios.create({ baseURL: '/api/v1' });
  c.defaults.adapter = (config) =>
    Promise.resolve({
      data: {},
      status: 200,
      statusText: 'OK',
      headers,
      config,
    });
  installDashboardFreshness(c);
  return c;
}

describe('installDashboardFreshness', () => {
  it('records the stamped time as sw-cache', async () => {
    await client({ [SW_CACHED_AT_HEADER]: '1000' }).get('/dashboard/widgets/collection-month');
    expect(getFreshness(key)).toEqual({ fetchedAt: 1000, source: 'sw-cache' });
  });

  it('records network without the header', async () => {
    await client().get('/dashboard/widgets/collection-month');
    expect(getFreshness(key)?.source).toBe('network');
  });

  it('treats a malformed header as network', async () => {
    await client({ [SW_CACHED_AT_HEADER]: 'abc' }).get('/dashboard/widgets/collection-month');
    expect(getFreshness(key)?.source).toBe('network');
  });

  it('ignores other routes', async () => {
    await client().get('/students');
    expect(getFreshness(['dashboard', 'widget', 'students'])).toBeUndefined();
  });

  it('is idempotent per client', () => {
    const c = axios.create();
    installDashboardFreshness(c);
    installDashboardFreshness(c);
    expect((c.interceptors.response as unknown as { handlers: unknown[] }).handlers).toHaveLength(
      1,
    );
  });
});
