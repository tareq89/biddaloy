import { validateSync } from 'class-validator';
import {
  IsRealDate,
  IsRealMonth,
  isRealDate,
  isRealMonth,
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
