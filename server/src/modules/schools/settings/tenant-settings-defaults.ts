import { TENANT_SETTINGS_SCHEMA_VERSION } from '../dto/tenant-settings.dto';
import type { RegionSettings, TenantSettings } from '@biddaloy/shared';

/**
 * bn-BD region defaults. #8.7.2 owns the canonical `RegionConfig` used by
 * the SPA; this is the server-side equivalent so a school with no stored
 * `region` block still resolves to sensible values instead of throwing.
 */
export const DEFAULT_REGION_SETTINGS: RegionSettings = {
  locale: 'bn-BD',
  currency: {
    code: 'BDT',
    symbol: '৳',
    position: 'prefix',
    decimals: 2,
    grouping: 'lakh-crore',
  },
  numerals: 'bengali',
  date: {
    format: 'DD/MM/YYYY',
    firstDayOfWeek: 0,
    calendar: 'gregory',
  },
  phone: {
    country: 'BD',
    pattern: '^(?:\\+?880|0)1[3-9]\\d{8}$',
    example: '01712345678',
    displayFormat: '+880 XXXX-XXXXXX',
  },
  address: {
    fields: ['village_or_area', 'post_office', 'upazila', 'district', 'division'],
    order: ['village_or_area', 'post_office', 'upazila', 'district', 'division'],
  },
  academicYear: {
    startMonth: 1,
  },
  identifiers: {
    national: '^[0-9]{10}$|^[0-9]{13}$|^[0-9]{17}$',
    student: '',
  },
  timezone: 'Asia/Dhaka',
};

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  version: TENANT_SETTINGS_SCHEMA_VERSION,
  region: DEFAULT_REGION_SETTINGS,
};
