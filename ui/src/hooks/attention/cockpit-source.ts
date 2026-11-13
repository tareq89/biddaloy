import { setAttentionSource } from '../../api/attention';
import { cockpitRequest } from '../cockpit-request';

/** Tells the server this request is a poll: it checks the session but does not renew it. */
export const COCKPIT_POLL_HEADER = 'X-Cockpit-Poll';

/**
 * The cockpit's attention bar reads `/platform/attention` (the owner's own alerts) over a plain
 * request: an owner has no school, so `apiClient` would refuse to send. Called once by the
 * cockpit shell's module (`_platform/route.tsx`) on the cockpit host only; school shells never call it.
 */
export function configureCockpitAttention(): void {
  setAttentionSource({
    base: '/platform/attention',
    cockpit: true,
    http: {
      // Bar, bell and alert reads are background polls: they must not renew the server's idle key.
      get: async (url, config) => ({
        data: await cockpitRequest({ url, ...config, headers: { [COCKPIT_POLL_HEADER]: '1' } }),
      }),
      post: async (url, data) => ({ data: await cockpitRequest({ method: 'POST', url, data }) }),
    },
  });
}
