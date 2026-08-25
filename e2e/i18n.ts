// [8.5.3] Locale-proof accessible-name lookups: specs resolve strings
// through the app's own message catalogs (`ui/src/i18n/locales`) instead
// of hardcoding Bangla. Default locale is `bn` — what a fresh browser
// context renders (ui/src/i18n/locale-storage.ts) — switchable per suite
// for future en coverage.
//
// Deliberately not react-i18next: specs need plain string lookup +
// `{{var}}` interpolation, nothing more.

import bnAcademicYears from '../ui/src/i18n/locales/bn/academicYears.json';
import bnAuth from '../ui/src/i18n/locales/bn/auth.json';
import bnClasses from '../ui/src/i18n/locales/bn/classes.json';
import bnCommon from '../ui/src/i18n/locales/bn/common.json';
import bnFeeGeneration from '../ui/src/i18n/locales/bn/feeGeneration.json';
import bnFees from '../ui/src/i18n/locales/bn/fees.json';
import bnFeeStructures from '../ui/src/i18n/locales/bn/feeStructures.json';
import bnGuardians from '../ui/src/i18n/locales/bn/guardians.json';
import bnNav from '../ui/src/i18n/locales/bn/nav.json';
import bnPayments from '../ui/src/i18n/locales/bn/payments.json';
import bnSettings from '../ui/src/i18n/locales/bn/settings.json';
import bnStudents from '../ui/src/i18n/locales/bn/students.json';
import enAcademicYears from '../ui/src/i18n/locales/en/academicYears.json';
import enAuth from '../ui/src/i18n/locales/en/auth.json';
import enClasses from '../ui/src/i18n/locales/en/classes.json';
import enCommon from '../ui/src/i18n/locales/en/common.json';
import enFeeGeneration from '../ui/src/i18n/locales/en/feeGeneration.json';
import enFees from '../ui/src/i18n/locales/en/fees.json';
import enFeeStructures from '../ui/src/i18n/locales/en/feeStructures.json';
import enGuardians from '../ui/src/i18n/locales/en/guardians.json';
import enNav from '../ui/src/i18n/locales/en/nav.json';
import enPayments from '../ui/src/i18n/locales/en/payments.json';
import enSettings from '../ui/src/i18n/locales/en/settings.json';
import enStudents from '../ui/src/i18n/locales/en/students.json';

const catalogs = {
  bn: {
    academicYears: bnAcademicYears,
    auth: bnAuth,
    classes: bnClasses,
    common: bnCommon,
    feeGeneration: bnFeeGeneration,
    fees: bnFees,
    feeStructures: bnFeeStructures,
    guardians: bnGuardians,
    nav: bnNav,
    payments: bnPayments,
    settings: bnSettings,
    students: bnStudents,
  },
  en: {
    academicYears: enAcademicYears,
    auth: enAuth,
    classes: enClasses,
    common: enCommon,
    feeGeneration: enFeeGeneration,
    fees: enFees,
    feeStructures: enFeeStructures,
    guardians: enGuardians,
    nav: enNav,
    payments: enPayments,
    settings: enSettings,
    students: enStudents,
  },
} as const;

export type Locale = keyof typeof catalogs;

/** Suite-wide default; `makeT('en')` for a suite that switches locale. */
export const DEFAULT_LOCALE: Locale = 'bn';

export function makeT(locale: Locale = DEFAULT_LOCALE) {
  return function t(key: string, params?: Record<string, string | number>): string {
    const [namespace, ...path] = key.split('.');
    let node: unknown = catalogs[locale][namespace as keyof (typeof catalogs)['bn']];
    for (const segment of path) {
      if (node === null || typeof node !== 'object') break;
      node = (node as Record<string, unknown>)[segment];
    }
    if (typeof node !== 'string') {
      throw new Error(`i18n key not found for locale "${locale}": ${key}`);
    }
    if (!params) return node;
    return node.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  };
}

/** Default-locale translator — what nearly every spec should import. */
export const t = makeT();
