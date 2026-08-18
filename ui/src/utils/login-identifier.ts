import { z } from 'zod';

import type { RegionConfig } from '../i18n/region-config';

import { parsePhone } from './phone';

export type LoginIdentifier =
  { kind: 'email'; email: string } | { kind: 'phone'; phone: string } | { kind: 'invalid' };

const emailSchema = z.email();

/**
 * The sign-in form has one field for either an email or a phone number —
 * this is what tells `POST /auth/login` (`LoginDto`'s separate `email?`/
 * `phone?`) which one the caller typed. `'@'` is a sufficient email/phone
 * discriminator: no valid Bangladeshi phone shape (digits, spaces, dashes,
 * a leading `+`) can contain one.
 *
 * Phone values are re-prefixed with a leading `0` before being returned —
 * `parsePhone` strips the trunk zero (and the country code) down to the
 * bare national number for formatting purposes, but `server/src/scripts/
 * seed.ts` and every real user record store the local `0`-prefixed shape
 * (e.g. `'01700000000'`), and `AuthService.validateUser` matches phone
 * exactly as stored — no normalization server-side. This `'0' + …`
 * re-attachment is a Bangladesh-specific assumption living here, not in
 * `parsePhone` itself (which stays region-neutral, per `RegionConfig`'s own
 * point), since login is the one place that needs the storage format
 * rather than the display-formatting national number.
 */
export function detectLoginIdentifier(raw: string, config: RegionConfig): LoginIdentifier {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'invalid' };

  if (trimmed.includes('@')) {
    const result = emailSchema.safeParse(trimmed);
    return result.success ? { kind: 'email', email: result.data } : { kind: 'invalid' };
  }

  const result = parsePhone(trimmed, config);
  return result.valid ? { kind: 'phone', phone: `0${result.value}` } : { kind: 'invalid' };
}
