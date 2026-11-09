/** Lower-case, no port. Anything that is not a plausible host name is not looked up at all. */
export function normalizeHost(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/:\d+$/, '');
  return host.length > 0 && host.length <= 253 && /^[a-z0-9.-]+$/.test(host) ? host : null;
}
