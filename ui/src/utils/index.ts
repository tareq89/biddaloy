/**
 * Formatters and helpers. All currency, number, phone and date formatting lives here so no component ever calls `Intl` directly.
 */
export { formatCurrency, parseCurrency } from './currency';
export { formatDate, parseDate, getAcademicYear, formatAcademicYear } from './date';
export { renderDigits, toLatinDigits } from './digits';
export { groupDigits } from './grouping';
export { detectLoginIdentifier, type LoginIdentifier } from './login-identifier';
export { formatName } from './name';
export { formatNumber, parseNumber } from './number';
export { formatPhone, parsePhone, type PhoneParseResult } from './phone';
export { boundedNumericString } from './zod-helpers';
