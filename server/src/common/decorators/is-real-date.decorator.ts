import { isISO8601, registerDecorator, ValidateBy, ValidationOptions } from 'class-validator';
import { todayInSchoolTz } from '../time';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** True for exactly `YYYY-MM-DD` that is a real calendar date (no roll-over). */
export function isRealDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Postgres has no year 0 (a 22008 500), and every 4-digit year from 0001 is in its range.
  if (y < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Date.UTC maps years 0-99 to 1900+; setUTCFullYear keeps the literal year.
  dt.setUTCFullYear(y);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** True for exactly `YYYY-MM` with month 01-12 and a year from 0001 (Postgres has no year 0). */
export function isRealMonth(value: unknown): boolean {
  return typeof value === 'string' && MONTH_RE.test(value) && !value.startsWith('0000');
}

function make(
  name: string,
  check: (v: unknown) => boolean,
  label: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) =>
    registerDecorator({
      name,
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: check,
        defaultMessage: (args) => `${args?.property} must be a real ${label}`,
      },
    });
}

export const IsRealDate = (o?: ValidationOptions) =>
  make('isRealDate', isRealDate, 'date (YYYY-MM-DD)', o);

export const IsRealMonth = (o?: ValidationOptions) =>
  make('isRealMonth', isRealMonth, 'month (YYYY-MM)', o);

/** `YYYY-MM-DD` strings compare correctly as plain strings. */
export function IsNotFutureDate(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isNotFutureDate',
      validator: {
        validate: (v: unknown) => typeof v === 'string' && v <= todayInSchoolTz(),
        defaultMessage: (args) => `${args?.property} must not be in the future`,
      },
    },
    options,
  );
}

const BIRTH_DATE_FLOOR = '1900-01-01';

/**
 * A real calendar date (no roll-over), from 1900-01-01 to today in the school
 * timezone. A full ISO timestamp is accepted on purpose (the public admission
 * form posts one); only its first 10 characters are range-checked.
 */
export function IsPlausibleBirthDate(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isPlausibleBirthDate',
      validator: {
        validate: (v: unknown) => {
          if (typeof v !== 'string' || !isISO8601(v, { strict: true })) return false;
          const day = v.slice(0, 10);
          return day >= BIRTH_DATE_FLOOR && day <= todayInSchoolTz();
        },
        defaultMessage: (args) =>
          `${args?.property} must be a real date between 1900-01-01 and today`,
      },
    },
    options,
  );
}
