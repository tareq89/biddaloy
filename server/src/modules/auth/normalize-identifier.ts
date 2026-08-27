/**
 * Normalizes a login identifier (email or phone) for use as a lockout /
 * attempt-counter key, so "User@x.com" and "user@x.com" share one bucket
 * instead of getting separate ones. This is independent of AuthService's
 * actual user lookup, which matches email/phone exactly as stored.
 */
export function normalizeLoginIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

/**
 * Normalizes an email address for STORAGE. Deliberately the same rule as
 * `normalizeLoginIdentifier` above (trim + lowercase) rather than a second,
 * subtly different one: `users.email` is a plain `character varying` with a
 * plain unique index, so Postgres compares it case-sensitively and would
 * happily hold both `foo@example.com` and `Foo@example.com` — two accounts
 * claiming one address, with `AuthService.validateUser` (exact match) handing
 * out whichever one the typed casing happens to hit. Writing the lowercased
 * form makes the unique index mean what the "already in use" check promises,
 * and keeps a user's stored identifier identical to what the lockout key and
 * their own re-typed casing resolve to. [5.4a]
 */
export function normalizeEmail(email: string): string {
  return normalizeLoginIdentifier(email);
}
