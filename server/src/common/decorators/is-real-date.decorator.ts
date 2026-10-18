import { registerDecorator, ValidationOptions } from 'class-validator';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** True for exactly `YYYY-MM-DD` that is a real calendar date (no roll-over). */
export function isRealDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Date.UTC maps years 0-99 to 1900+; setUTCFullYear keeps the literal year.
  dt.setUTCFullYear(y);
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

/** True for exactly `YYYY-MM` with month 01-12. */
export function isRealMonth(value: unknown): boolean {
  return typeof value === 'string' && MONTH_RE.test(value);
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
