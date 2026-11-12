import { setAttentionSource } from '../../api/attention';
import { cockpitRequest } from '../cockpit-request';

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
      get: async (url, config) => ({ data: await cockpitRequest({ url, ...config }) }),
      post: async (url, data) => ({ data: await cockpitRequest({ method: 'POST', url, data }) }),
    },
  });
}
