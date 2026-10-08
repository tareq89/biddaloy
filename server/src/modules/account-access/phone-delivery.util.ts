import { BD_PHONE_REGEX } from '../students/dto/students.dto';

/**
 * Canonical E.164-ish form of a phone, for the D31 SMS-prefix test only
 * (stored phones are "as typed"): `00…` becomes `+…`, Bangladesh local
 * `01XXXXXXXXX` / `8801…` becomes `+8801…`. Anything else without a `+` is
 * returned unchanged (still no `+`), so `isSmsAllowed` refuses it.
 */
export function toE164ish(phone: string): string {
  const p = phone.replace(/[\s().-]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return `+${p.slice(2)}`;
  if (BD_PHONE_REGEX.test(p)) return `+880${p.replace(/^(?:\+?880|0)/, '')}`;
  return p;
}

/** D31: SMS only to numbers whose canonical form starts with an allowed prefix (comma list, e.g. `+880`). */
export function isSmsAllowed(phone: string, allowedPrefixes: string): boolean {
  const e164 = toE164ish(phone);
  return allowedPrefixes
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .some((p) => e164.startsWith(p));
}
