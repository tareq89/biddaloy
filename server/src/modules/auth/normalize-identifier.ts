/**
 * Normalizes a login identifier (email or phone) for use as a lockout /
 * attempt-counter key, so "User@x.com" and "user@x.com" share one bucket
 * instead of getting separate ones. This is independent of AuthService's
 * actual user lookup, which matches email/phone exactly as stored.
 */
export function normalizeLoginIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}
