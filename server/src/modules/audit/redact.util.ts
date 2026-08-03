/**
 * old_values/new_values are jsonb snapshots of whatever entity fields a
 * caller passes in — they must never carry a password hash, a token, or a
 * provider API key into a table that (by design, via the write-only
 * trigger) can never be edited or deleted afterward. Matched case-
 * insensitively by exact key name, recursively, since a snapshot can nest
 * (e.g. a `metadata` blob echoing whatsapp params).
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordhash',
  'token',
  'tokens',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'api_key',
  'apikey',
  'secret',
  'client_secret',
  'clientsecret',
  'jti',
  'authorization',
]);

const REDACTED = '[REDACTED]';

// A snapshot passed through the @Audited interceptor is a raw response
// body, which can nest a TypeORM entity carrying a bidirectional relation —
// recursing without a floor risks a RangeError on a cycle.
const MAX_DEPTH = 10;

export function redactSensitiveFields<T>(value: T): T {
  return redact(value, 0) as T;
}

function redact(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) {
    return depth >= MAX_DEPTH ? REDACTED : value.map((item) => redact(item, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    // A Date (or Buffer, or any other non-plain object) has no own
    // enumerable keys — walking it with Object.entries would silently
    // flatten it to `{}`, permanently losing the value in a table the
    // write-only trigger never lets anyone correct afterward.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    if (depth >= MAX_DEPTH) {
      return REDACTED;
    }
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(val, depth + 1);
    }
    return result;
  }
  return value;
}
