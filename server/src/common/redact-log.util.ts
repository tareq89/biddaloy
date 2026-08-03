const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Same digit shape as BD_PHONE_REGEX in modules/students/dto/students.dto.ts
// (kept as a separate constant rather than imported, since `common/` sits
// below feature modules in this codebase's layering) — that one is anchored
// (^...$) for whole-string DTO validation; this scans for the same shape as
// a substring inside a larger line (a URL, an error message), unanchored
// and global instead. Keep both in sync if the phone format ever changes.
const PHONE_PATTERN = /(?:\+?880|0)1[3-9]\d{8}/g;

const SENSITIVE_QUERY_KEYS = ['password', 'token', 'access_token', 'refresh_token', 'secret', 'api_key', 'apikey'];

/**
 * Scrubs email/phone-shaped substrings and known-sensitive query-param
 * values out of a line before it's logged (#36). Applied to request
 * URLs and error detail messages — the two places PII most often leaks
 * into logs, since neither is a structured object redact.util.ts's
 * key-based approach could walk.
 *
 * Deliberately tested against a *failing* request, not just a successful
 * one — a redaction helper that only runs on the happy path is worthless,
 * since the leak is usually in an error log written under debugging
 * pressure.
 */
export function redactPii(text: string): string {
  let result = text.replace(EMAIL_PATTERN, '[REDACTED_EMAIL]').replace(PHONE_PATTERN, '[REDACTED_PHONE]');

  for (const key of SENSITIVE_QUERY_KEYS) {
    const queryParamPattern = new RegExp(`([?&]${key}=)[^&\\s]+`, 'gi');
    result = result.replace(queryParamPattern, '$1[REDACTED]');
  }

  return result;
}
