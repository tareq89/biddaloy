/**
 * The one seeded Faker instance every factory in this directory shares.
 * `[en, base]` — `en` for person/phone/location generators, `base` as the
 * fallback a handful of `en` modules (e.g. `internet.userAgent`) need but
 * don't ship themselves. `@faker-js/faker`'s `bn_BD` locale ships nothing
 * but `date`/`metadata` (no person/phone/location generators as of v9), so
 * Bangla output comes from `./bangla-data.ts`'s hand-curated pools instead,
 * picked via this same seeded instance's `helpers.arrayElement`.
 *
 * `resetFactorySeed()` re-seeds to the same fixed value — wired into
 * `ui/src/test/setup.ts`'s `afterEach` so a factory call's output depends
 * only on how many times *this test* has called a factory, never on what
 * ran before it. Seeding the RNG alone isn't sufficient for reproducing
 * *dates*, though: `faker.date.*` defaults to `Date.now()` as its
 * reference point, which drifts by the millisecond between any two calls —
 * every factory that generates a date must pass `FACTORY_REFERENCE_DATE`
 * as `refDate` explicitly, or "same seed" stops meaning "same output".
 */
import { Faker, en, base } from '@faker-js/faker';

const FACTORY_SEED = 20260101;

export const faker = new Faker({ locale: [en, base] });

export const FACTORY_REFERENCE_DATE = new Date('2026-01-01T00:00:00.000Z');

export function resetFactorySeed(): void {
  faker.seed(FACTORY_SEED);
}

resetFactorySeed();
