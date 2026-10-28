/**
 * #2955 — one role, one label. `staff.roles` is canonical; the other
 * role maps must not drift from it (ADMIN was "Headmaster", EXECUTIVE
 * "Executive" in the application timeline).
 */
import { describe, expect, it } from 'vitest';

import bnApplicationsDetail from './locales/bn/applicationsDetail.json';
import bnAuth from './locales/bn/auth.json';
import bnStaff from './locales/bn/staff.json';
import enApplicationsDetail from './locales/en/applicationsDetail.json';
import enAuth from './locales/en/auth.json';
import enStaff from './locales/en/staff.json';

const cases = [
  ['en', enStaff.roles, enApplicationsDetail.roles, enAuth.schoolPicker.roles],
  ['bn', bnStaff.roles, bnApplicationsDetail.roles, bnAuth.schoolPicker.roles],
] as const;

describe.each(cases)('role labels (%s)', (_lang, staff, detail, picker) => {
  const canonical: Record<string, string> = staff;
  it.each(Object.entries(detail))('applicationsDetail.roles.%s matches staff.roles', (k, v) => {
    expect(v).toBe(canonical[k]);
  });
  it.each(Object.entries(picker))('auth.schoolPicker.roles.%s matches staff.roles', (k, v) => {
    if (k in canonical) expect(v).toBe(canonical[k]);
  });
});
