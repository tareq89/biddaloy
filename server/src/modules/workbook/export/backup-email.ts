import { TemplateLocale } from '../../account-access/account-access-templates';

const FAILURE_REASON_MAX_LEN = 200;
const DEFAULT_FAILURE_REASON = 'The export could not be completed.';

/** APP_BASE_URL + the SPA deep link. No token: the page is session-authenticated. */
export function buildBackupLink(appBaseUrl: string, jobId: string): string {
  return `${appBaseUrl}/settings?backup=${encodeURIComponent(jobId)}`;
}

/** bigint-as-string -> one decimal place, MiB. null/''/NaN -> '0.0'. */
export function formatSizeMb(sizeBytes: string | null): string {
  const bytes = Number(sizeBytes);
  if (!sizeBytes || !Number.isFinite(bytes)) return '0.0';
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** Locale- and timezone-aware, for the templates. */
export function formatTimestamp(
  value: Date | null,
  locale: TemplateLocale,
  timezone: string,
): string {
  if (!value) return '';
  const intlLocale = locale === 'bn' ? 'bn-BD' : 'en-GB';
  try {
    return new Intl.DateTimeFormat(intlLocale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(value);
  } catch {
    // An unexpected `settings.region.timezone` (e.g. stale/invalid) throws
    // a RangeError from Intl — degrade to UTC rather than let a backup
    // email fail to format entirely.
    return new Intl.DateTimeFormat(intlLocale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(value);
  }
}

/** One plain line, never a stack trace, never a storage key. */
export function failureReason(error: string | null): string {
  const trimmed = error?.trim();
  if (!trimmed) return DEFAULT_FAILURE_REASON;
  const firstLine = trimmed.split('\n')[0].trim();
  if (!firstLine) return DEFAULT_FAILURE_REASON;
  return firstLine.length > FAILURE_REASON_MAX_LEN
    ? firstLine.slice(0, FAILURE_REASON_MAX_LEN)
    : firstLine;
}
