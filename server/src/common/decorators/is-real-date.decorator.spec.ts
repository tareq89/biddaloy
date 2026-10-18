import { validateSync } from 'class-validator';
import { todayInSchoolTz } from '../time';
import {
  IsRealDate,
  IsRealMonth,
  isRealDate,
  isRealMonth,
  IsPlausibleBirthDate,
} from './is-real-date.decorator';

class Dto {
  @IsRealDate() d!: unknown;
  @IsRealMonth() m!: unknown;
}

describe('isRealDate', () => {
  it.each([
    '2026-02-30',
    '2026-13-01',
    '2025-02-29',
    '2026-2-3',
    '2026-02-03T00:00:00Z',
    '0000-01-01',
    '0000-02-29',
    '',
    20260203,
  ])('rejects %p', (v) => expect(isRealDate(v)).toBe(false));

  it.each(['2028-02-29', '2026-12-31', '0001-01-01'])('accepts %p', (v) =>
    expect(isRealDate(v)).toBe(true),
  );
});

describe('isRealMonth', () => {
  it.each(['2026-13', '2026-00', '9999-99', '2026-1', '0000-05', 5])('rejects %p', (v) =>
    expect(isRealMonth(v)).toBe(false),
  );
  it('accepts 2026-12', () => expect(isRealMonth('2026-12')).toBe(true));
});

describe('messages', () => {
  it('start with the property name', () => {
    const errs = validateSync(Object.assign(new Dto(), { d: 'x', m: 'y' }));
    const msgs = errs.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(msgs).toContain('d must be a real date (YYYY-MM-DD)');
    expect(msgs).toContain('m must be a real month (YYYY-MM)');
  });
});

describe('IsPlausibleBirthDate', () => {
  class Birth {
    @IsPlausibleBirthDate() dob!: unknown;
  }
  const errorsFor = (dob: unknown) => validateSync(Object.assign(new Birth(), { dob }));
  const addDays = (ymd: string, n: number) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  it.each(['2018-05-01', '1900-01-01', '2018-05-01T00:00:00.000Z'])('accepts %p', (v) =>
    expect(errorsFor(v)).toHaveLength(0),
  );
  it('accepts today', () => expect(errorsFor(todayInSchoolTz())).toHaveLength(0));

  it.each(['2018-02-30', '2025-02-29', '1899-12-31', 'abc', 20180501])('rejects %p', (v) =>
    expect(errorsFor(v)).toHaveLength(1),
  );
  it('rejects tomorrow', () => expect(errorsFor(addDays(todayInSchoolTz(), 1))).toHaveLength(1));

  it('message starts with the property name', () => {
    const msgs = errorsFor('2018-02-30').flatMap((e) => Object.values(e.constraints ?? {}));
    expect(msgs).toContain('dob must be a real date between 1900-01-01 and today');
  });
});
