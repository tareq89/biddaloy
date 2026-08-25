import type { RegionConfig } from '@biddaloy/ui/i18n';
import { formatPhone, parsePhone } from '@biddaloy/ui/utils';

/**
 * Same shape (and reasoning) as `guardians/-format-guardian-phone.ts`:
 * `formatPhone` throws on anything `parsePhone` rejects, and staff phone
 * data can predate validation, so an unparseable stored value renders
 * as-is instead of crashing the row it's in. Kept as this route's own
 * copy rather than importing across route folders — route-local helpers
 * stay route-local.
 */
export function formatStaffPhone(phone: string | null, config: RegionConfig): string | null {
  if (!phone) return null;
  return parsePhone(phone, config).valid ? formatPhone(phone, config) : phone;
}
