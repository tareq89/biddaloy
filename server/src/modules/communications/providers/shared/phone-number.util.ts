/**
 * Normalizes a Bangladeshi phone number to the digits-only, country-code-
 * prefixed format expected by SMS gateways and Meta's WhatsApp Cloud API
 * (e.g. "8801712345678") — no leading '+' or '00'.
 *
 * Accepts local ("01712345678"), "00"-prefixed, or "+"-prefixed input.
 */
export function normalizeBdPhoneNumber(phone: string): string {
  let digits = phone.replace(/[^\d]/g, '');

  // No digits at all (e.g. letters): do not invent a valid-looking "88".
  if (digits === '') return '';

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // A local BD number always starts with 0 (01x mobile, 02-09 area codes),
  // so anything already starting with 88 is country-coded — leave it. That
  // makes this a fixed point on its own output, which matters because
  // admission-applicant.service.ts stores this function's result and later
  // re-normalizes it for comparison.
  if (!digits.startsWith('88')) {
    digits = `88${digits}`;
  }

  return digits;
}

/**
 * The last 10 digits: a Bangladeshi mobile's national number, the same for
 * "01712345678", "+8801712345678", "8801712345678" and "1712345678".
 * For matching a phone stored as typed against one stored canonical.
 * ponytail: a format-blind match, not a canonical stored form; #1701 owns that.
 */
export function bdPhoneTail(phone: string): string {
  return phone.replace(/[^\d]/g, '').slice(-10);
}
