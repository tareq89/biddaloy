/**
 * Every country-specific assumption a component might otherwise hardcode
 * — currency symbol, digit shape, date format, phone pattern, address
 * layout, when the academic year starts, national/student ID shape,
 * timezone — becomes **data** instead. Adding a country is one config
 * object and zero component changes; `region-config.spec.ts`'s "a second
 * region" suite proves this holds by running every formatter in
 * `ui/src/utils` against a region that isn't Bangladesh.
 */
import type { Locale } from './locale-storage';

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
  date: {
    /** `formatDate`'s token order — currently always numeric ISO shape
     * (`ui/src/utils/date.ts` doesn't localize month names; that needs
     * real translated strings, i18next's job, not a formatter's), kept
     * here so the shape exists for a locale that later does need it. */
    format: string;
    /** 0 (Sunday) – 6 (Saturday). */
    firstDayOfWeek: number;
    calendar: string;
  };
  phone: {
    /** E.164 country calling code, e.g. `'880'`. */
    country: string;
    /** Matches the national number *after* the country code and any
     * leading trunk `0` have been stripped — e.g. `1XXXXXXXXX` (10 digits,
     * starting `1`) for a Bangladeshi mobile number. */
    pattern: RegExp;
    example: string;
    /** Mask for `formatPhone`'s national-number portion — `X` is a digit
     * placeholder, everything else is a literal. `'XXXX-XXXXXX'` turns
     * `1712345678` into `1712-345678`; a region with a different grouping
     * (say `XXX XXX XXXX`) is a mask change, not a `formatPhone` change. */
    displayFormat: string;
  };
  address: {
    /** Field keys a form should collect, most-specific first. */
    fields: string[];
    /** Display order, most-specific first — separate from `fields`
     * because a region can want the two to differ (rare, but the two
     * concerns are genuinely different: what to collect vs. how to lay
     * it out). */
    order: string[];
  };
  academicYear: {
    /** 1 (January) – 12 (December). BD's academic year traditionally
     * starts in January, but this stays configurable per the epic doc's
     * "the BD academic year straddles calendar years" note — a school on
     * a July–June cycle sets this to `7`. */
    startMonth: number;
  };
  identifiers: {
    /** Regex source (not a compiled `RegExp`, for symmetry with how this
     * travels through the tenant-settings API once #8.7.14 sources it
     * from there — a `RegExp` doesn't survive JSON). Empty string means
     * "no format constraint enforced." */
    national: string;
    student: string;
  };
  timezone: string;
}

const bnDigits = '০১২৩৪৫৬৭৮৯';

export const REGION_BD_BN: RegionConfig = {
  locale: 'bn-BD',
  currency: { code: 'BDT', symbol: '৳', position: 'prefix', decimals: 2, grouping: 'lakh-crore' },
  numerals: 'bengali',
  date: { format: 'YYYY-MM-DD', firstDayOfWeek: 0, calendar: 'gregory' },
  phone: {
    country: '880',
    pattern: /^1\d{9}$/,
    example: '1712-345678',
    displayFormat: 'XXXX-XXXXXX',
  },
  address: {
    fields: ['village_or_area', 'post_office', 'upazila', 'district', 'division'],
    order: ['village_or_area', 'post_office', 'upazila', 'district', 'division'],
  },
  academicYear: { startMonth: 1 },
  identifiers: { national: '^[0-9]{10}$|^[0-9]{13}$|^[0-9]{17}$', student: '' },
  timezone: 'Asia/Dhaka',
};

export const REGION_BD_EN: RegionConfig = {
  ...REGION_BD_BN,
  locale: 'en-BD',
  currency: { ...REGION_BD_BN.currency },
  numerals: 'latin',
};

/** Which build-time default a locale falls back to absent any tenant
 * override — `RegionConfigProvider`'s own default, and #8.7.14's
 * `resolveRegionConfig`'s per-field fallback target for a tenant with no
 * (or only partial) stored region settings. Lives here rather than in
 * `region-config-provider.tsx` so both can import one copy instead of
 * `resolveRegionConfig` needing its own duplicate of this mapping. */
export const LOCALE_REGION_DEFAULTS: Record<Locale, RegionConfig> = {
  bn: REGION_BD_BN,
  en: REGION_BD_EN,
};

export { bnDigits };
