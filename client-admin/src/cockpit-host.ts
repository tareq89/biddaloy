/**
 * [98.4.01] True on the cockpit hostname (`cockpit.schoolmanagerp.com`,
 * `cockpit-staging.…`, dev `cockpit.localhost:5173`).
 *
 * This only picks which screens to show. The server and nginx decide what is
 * allowed, so nothing here is a security control.
 */
export function isCockpitHost(hostname: string = globalThis.location.hostname): boolean {
  return /^cockpit(-[a-z0-9]+)?\./.test(hostname);
}
