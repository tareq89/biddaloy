import type { RegionConfig } from '@biddaloy/ui/i18n';
import { formatPhone, parsePhone } from '@biddaloy/ui/utils';

/**
 * [8.11.4]'s "phone numbers format per RegionConfig" AC — shared by the
 * list page's Phone column and the detail page's Information tab, both of
 * which show a guardian's stored phone number, not an editable one
 * (`PhoneInput` is for the edit form, not display).
 *
 * `formatPhone` itself throws on anything `parsePhone` rejects — real
 * guardian data predates this validation (imported rosters, numbers typed
 * free-form over the phone), so a stored value that doesn't parse falls
 * back to rendering as-is instead of crashing the row/tab it's in.
 */
export function formatGuardianPhone(phone: string | null, config: RegionConfig): string | null {
  if (!phone) return null;
  return parsePhone(phone, config).valid ? formatPhone(phone, config) : phone;
}
