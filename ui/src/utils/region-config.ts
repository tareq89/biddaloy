/**
 * A narrow, local stand-in for [8.7.2]'s `RegionConfig` — that ticket
 * (interface shape, injectable provider, tenant-settings source, a second
 * region fixture) isn't built yet, but this one depends on it for currency/
 * numeral/phone shape. What's here covers exactly what the formatters in
 * this file need (currency, numerals, phone pattern, academic-year start
 * month) for the two locales this repo ships today — not the full
 * interface from the epic doc (`address`, `identifiers`, `timezone` are
 * absent). Delete this file and import the real one once [8.7.2] lands;
 * every formatter here takes a `RegionConfig` as an explicit parameter
 * rather than reaching for a module-level default, so that swap is a
 * type-only change at each call site, not a behavioural one.
 */

export type NumeralSystem = 'latin' | 'bengali';
export type CurrencyGrouping = 'lakh-crore' | 'thousand';

export interface RegionConfig {
  locale: string;
  currency: {
    code: string;
    symbol: string;
    position: 'prefix' | 'suffix';
    /** Number of minor-unit digits — 2 for BDT (taka/paisa). */
    decimals: number;
    grouping: CurrencyGrouping;
  };
  numerals: NumeralSystem;
  phone: {
    /** E.164 country calling code, e.g. `'880'`. */
    country: string;
    /** Matches the national number *after* the country code and any
     * leading trunk `0` have been stripped — e.g. `1XXXXXXXXX` (10 digits,
     * starting `1`) for a Bangladeshi mobile number. */
    pattern: RegExp;
    example: string;
  };
  academicYear: {
    /** 1 (January) – 12 (December). BD's academic year traditionally
     * starts in January, but this stays configurable per the epic doc's
     * "the BD academic year straddles calendar years" note — a school on
     * a July–June cycle sets this to `7`. */
    startMonth: number;
  };
}

const bnDigits = '০১২৩৪৫৬৭৮৯';

export const REGION_BD_BN: RegionConfig = {
  locale: 'bn-BD',
  currency: { code: 'BDT', symbol: '৳', position: 'prefix', decimals: 2, grouping: 'lakh-crore' },
  numerals: 'bengali',
  phone: { country: '880', pattern: /^1\d{9}$/, example: '1712-345678' },
  academicYear: { startMonth: 1 },
};

export const REGION_BD_EN: RegionConfig = {
  ...REGION_BD_BN,
  locale: 'en-BD',
  currency: { ...REGION_BD_BN.currency },
  numerals: 'latin',
};

export { bnDigits };
