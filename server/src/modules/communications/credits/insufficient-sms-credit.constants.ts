/**
 * [15.6.5/#548] `shared/` has no cross-cutting API error-code list (only
 * `enums/`, `sanitize/`, `sms/`, `types/`, `audit/`) — this constant lives
 * here instead. Thrown as a 409 `ConflictException({ message, details: {
 * code: INSUFFICIENT_SMS_CREDIT, required, available } })` from
 * `BulkReminderService.sendBulk`, matching the `details.code` convention
 * `ContextGuard` already uses for `TENANT_SUSPENDED` — see
 * `AllExceptionsFilter`/`buildErrorResponseBody`, which surfaces a 4xx
 * exception's `details` key verbatim in the response body.
 */
export const INSUFFICIENT_SMS_CREDIT = 'INSUFFICIENT_SMS_CREDIT';

/** [#2216] `metadata.reason` on a log whose credit reservation threw (DB
 * error, settings lookup) — the log is failed rather than left QUEUED. */
export const CREDIT_RESERVE_FAILED = 'CREDIT_RESERVE_FAILED';
