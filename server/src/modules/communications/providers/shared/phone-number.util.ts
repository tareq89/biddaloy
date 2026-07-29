/**
 * Normalizes a Bangladeshi phone number to the digits-only, country-code-
 * prefixed format expected by SMS gateways and Meta's WhatsApp Cloud API
 * (e.g. "8801712345678") — no leading '+' or '00'.
 *
 * Accepts local ("01712345678"), "00"-prefixed, or "+"-prefixed input.
 */
export function normalizeBdPhoneNumber(phone: string): string {
  let digits = phone.replace(/[^\d]/g, '');

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('0')) {
    digits = `88${digits}`;
  } else if (!digits.startsWith('880')) {
    digits = `88${digits}`;
  }

  return digits;
}
