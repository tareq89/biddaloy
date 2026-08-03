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

export function redactSensitiveFields<T>(value: T): T {
  return redact(value) as T;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(val);
    }
    return result;
  }
  return value;
}
