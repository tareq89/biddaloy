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
