import { z } from 'zod';

/**
 * A digit-string field with a server-enforced numeric range — the same
 * "keep it a string end to end, parse once on submit" shape
 * `EmailSection.tsx`/`RegionalSection.tsx` already use for RHF-resolver
 * typing reasons (see either file's own comment), but bounded: a value
 * like `"999"` for a 0-4 decimals field or a 1-12 start month currently
 * passes client-side validation and only fails as an opaque mutation
 * error from the server's own `@Min`/`@Max` decorators.
 */
export function boundedNumericString(min: number, max: number) {
  return z
    .string()
    .regex(/^\d+$/, { message: 'Must be a number' })
    .refine((value) => Number(value) >= min && Number(value) <= max, {
      message: `Must be between ${min} and ${max}`,
    });
}
