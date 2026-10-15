/**
 * [8.10.7.5.15] D52: record how old each dashboard widget response is, so
 * `CachedDataNotice` can label figures the service worker replayed offline.
 * The SW already caches `GET /api/v1/dashboard/*` and stamps `x-sw-cached-at`.
 */
import { apiClient, recordFreshness } from '@biddaloy/ui/api';
import type { AxiosInstance } from 'axios';

import { SW_CACHED_AT_HEADER } from '../../pwa/cache-policy';

const WIDGET_URL = /^\/?dashboard\/widgets\/([a-z0-9-]+)/;
const installed = new WeakSet<AxiosInstance>();

export function installDashboardFreshness(client: AxiosInstance = apiClient): void {
  if (installed.has(client)) return;
  installed.add(client);
  client.interceptors.response.use((res) => {
    try {
      const key = WIDGET_URL.exec(res.config.url ?? '')?.[1];
      if (key) {
        const stamped = Number(res.headers?.[SW_CACHED_AT_HEADER]);
        const cached = Number.isFinite(stamped) && stamped > 0;
        recordFreshness(['dashboard', 'widget', key], {
          fetchedAt: cached ? stamped : Date.now(),
          source: cached ? 'sw-cache' : 'network',
        });
      }
    } catch {
      // Labelling must never break a response.
    }
    return res;
  });
}
