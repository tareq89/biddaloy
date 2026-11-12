/**
 * [98.4.07] The sweeps log in on the school host. Manifest entries with `"host": "cockpit"` are
 * only reachable on the cockpit host (own sign-in, own session), so every sweep drops them.
 */
export const onSchoolHost = <T extends { host?: string }>(routes: readonly T[]): T[] =>
  routes.filter((r) => r.host !== 'cockpit');
