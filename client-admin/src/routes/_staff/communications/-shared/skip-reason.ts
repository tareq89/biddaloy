/**
 * `SkipReason` (server `reminders.service.ts`) → `communications`
 * namespace i18n key. The snake_case strings are the server's own
 * wire values; anything unrecognised (a future reason this UI predates)
 * falls back to the raw string rather than a broken key — a skipped
 * guardian must never be silently unexplained, per the issue's "skipped
 * list is as important as recipients" framing.
 */
const SKIP_REASON_KEYS: Record<string, string> = {
  no_open_dues: 'skipReasons.no_open_dues',
  no_guardians: 'skipReasons.no_guardians',
  preferred_medium_not_in_requested_mediums:
    'skipReasons.preferred_medium_not_in_requested_mediums',
  preferred_medium_has_no_automated_provider:
    'skipReasons.preferred_medium_has_no_automated_provider',
  guardian_has_no_address_for_preferred_medium:
    'skipReasons.guardian_has_no_address_for_preferred_medium',
  guardian_notifications_disabled: 'skipReasons.guardian_notifications_disabled',
};

export function skipReasonKey(reason: string): string | undefined {
  return SKIP_REASON_KEYS[reason];
}
