import { describe, it, expect } from 'vitest';
import { redactPii } from './redact-log.util';

describe('redactPii', () => {
  it('redacts an email address', () => {
    expect(redactPii('login failed for admin@example.com')).toBe('login failed for [REDACTED_EMAIL]');
  });

  it('redacts a Bangladeshi phone number in any of its accepted forms', () => {
    expect(redactPii('guardian phone: 01712345678')).toBe('guardian phone: [REDACTED_PHONE]');
    expect(redactPii('guardian phone: +8801712345678')).toBe('guardian phone: [REDACTED_PHONE]');
    expect(redactPii('guardian phone: 8801712345678')).toBe('guardian phone: [REDACTED_PHONE]');
  });

  it('redacts multiple occurrences in the same line', () => {
    expect(redactPii('a@b.com and c@d.com')).toBe('[REDACTED_EMAIL] and [REDACTED_EMAIL]');
  });

  // The issue's own gotcha: this must work on a failing/error line, not
  // just a clean success message — that's exactly where debugging pressure
  // tempts someone into logging everything unredacted.
  it('redacts PII embedded in a validation error message from a failing request', () => {
    const errorLine =
      'POST /api/v1/auth/login → 401: Invalid credentials for identifier admin@example.com [requestId=abc-123]';

    expect(redactPii(errorLine)).toBe(
      'POST /api/v1/auth/login → 401: Invalid credentials for identifier [REDACTED_EMAIL] [requestId=abc-123]',
    );
  });

  it('redacts a sensitive query-param value while leaving the key and other params intact', () => {
    expect(redactPii('/api/v1/reset?token=abc123&page=1')).toBe('/api/v1/reset?token=[REDACTED]&page=1');
    expect(redactPii('/api/v1/login?password=hunter2')).toBe('/api/v1/login?password=[REDACTED]');
  });

  it('leaves text with no PII untouched', () => {
    expect(redactPii('GET /api/v1/health → 200 [requestId=abc]')).toBe('GET /api/v1/health → 200 [requestId=abc]');
  });
});
