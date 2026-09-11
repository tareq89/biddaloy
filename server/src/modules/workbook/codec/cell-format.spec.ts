import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromCell, normalizeCell, toCell } from './cell-format';
import type { ColumnSpec } from './tab-spec';

function col(overrides: Partial<ColumnSpec> & Pick<ColumnSpec, 'type'>): ColumnSpec {
  return { key: 'amount', label: { en: 'Amount', bn: 'পরিমাণ' }, ...overrides };
}

const TAB = 'student_fees';
const ROW = 7;

/** Narrows the union so tests can read `.value` / `.error` directly. */
function value(result: ReturnType<typeof fromCell>): unknown {
  if ('error' in result) throw new Error(`expected a value, got: ${result.error.message}`);
  return result.value;
}

function error(result: ReturnType<typeof fromCell>) {
  if (!('error' in result)) throw new Error(`expected an error, got: ${String(result.value)}`);
  return result.error;
}

describe('toCell', () => {
  // Business-critical: money is formatted from a decimal string with string
  // operations. 10.1 must become '10.10', never 10.100000000000001.
  it.each([
    ['10.1', '10.10'],
    ['10', '10.00'],
    ['1500.00', '1500.00'],
    ['0.5', '0.50'],
    ['-25.5', '-25.50'],
    ['-0', '0.00'],
  ])('formats money %s as %s', (input, expected) => {
    expect(toCell('money', input)).toBe(expected);
  });

  it('rejects a money value that is not a plain decimal string', () => {
    expect(() => toCell('money', '1e2')).toThrow(/as money/);
    expect(() => toCell('money', 10.1)).toThrow(/as money/);
  });

  it('formats a date as YYYY-MM-DD', () => {
    expect(toCell('date', '2026-03-09')).toBe('2026-03-09');
  });

  // Business-critical: node-postgres parses a Postgres `date` column into a
  // JS Date at *local* midnight. Going via toISOString() would convert that
  // instant to UTC and move the day backwards on any server east of
  // Greenwich — in Asia/Dhaka every academic year and invoice due date would
  // export one day early. Constructing with local components is exactly what
  // the driver hands us for a `date` column.
  it('does not shift the day for a date parsed at local midnight', () => {
    expect(toCell('date', new Date(2026, 2, 9))).toBe('2026-03-09');
    expect(toCell('date', new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(toCell('date', new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('formats a datetime as an ISO UTC timestamp', () => {
    expect(toCell('datetime', new Date('2026-03-09T22:00:00.000Z'))).toBe(
      '2026-03-09T22:00:00.000Z',
    );
  });

  it('formats a bool as TRUE or FALSE', () => {
    expect(toCell('bool', true)).toBe('TRUE');
    expect(toCell('bool', false)).toBe('FALSE');
  });

  it('formats an int as a number so the cell sorts numerically', () => {
    expect(toCell('int', 42)).toBe(42);
    expect(toCell('int', '42')).toBe(42);
  });

  it('formats json with JSON.stringify', () => {
    expect(toCell('json', { sms: { enabled: true } })).toBe('{"sms":{"enabled":true}}');
  });

  it('joins a ref-list with semicolons', () => {
    expect(toCell('ref-list', ['Six', 'Seven'])).toBe('Six;Seven');
  });

  it('rejects an int that is not a whole number rather than truncating it', () => {
    expect(() => toCell('int', '42.9')).toThrow(/as an int/);
    expect(() => toCell('int', '12abc')).toThrow(/as an int/);
    expect(() => toCell('int', 4.2)).toThrow(/as an int/);
  });

  it.each(['uuid', 'string', 'enum', 'ref'] as const)('formats %s as a string', (type) => {
    expect(toCell(type, 'Six')).toBe('Six');
  });

  it.each(['money', 'date', 'json', 'string', 'int'] as const)(
    'formats a null %s as an empty cell',
    (type) => {
      expect(toCell(type, null)).toBeNull();
      expect(toCell(type, undefined)).toBeNull();
    },
  );
});

describe('normalizeCell', () => {
  it('maps Bengali digits to ASCII and trims', () => {
    expect(normalizeCell(' ১২৩ ')).toBe('123');
    expect(normalizeCell('০১৭১২৩৪৫৬৭৮')).toBe('01712345678');
  });

  it('collapses inner whitespace', () => {
    expect(normalizeCell('  Class   Six \n Blue ')).toBe('Class Six Blue');
  });

  it('renders a Date as an ISO string', () => {
    expect(normalizeCell(new Date('2026-03-09T00:00:00.000Z'))).toBe('2026-03-09T00:00:00.000Z');
  });

  it('flattens exceljs rich text to plain text', () => {
    expect(normalizeCell({ richText: [{ text: 'Class ' }, { text: 'Six' }] })).toBe('Class Six');
  });

  it('unwraps a formula cell to its result', () => {
    expect(normalizeCell({ formula: 'A1*2', result: 84 })).toBe('84');
  });

  it('unwraps a hyperlink cell to its text', () => {
    expect(normalizeCell({ text: 'Invoice', hyperlink: 'https://example.test' })).toBe('Invoice');
  });

  it('renders null and undefined as an empty string', () => {
    expect(normalizeCell(null)).toBe('');
    expect(normalizeCell(undefined)).toBe('');
  });
});

describe('fromCell Bengali digit handling', () => {
  // A Bengali digit is a digit in a numeric column and part of the text in a
  // prose column. Mapping it everywhere would rewrite a school named
  // `৫ নম্বর সরকারি বিদ্যালয়` to `5 নম্বর ...`.
  it('maps Bengali digits in numeric and date columns', () => {
    expect(value(fromCell(col({ type: 'int' }), '১২৩', TAB, ROW))).toBe(123);
    expect(value(fromCell(col({ type: 'money' }), '১৫০০.৫', TAB, ROW))).toBe('1500.50');
    expect(value(fromCell(col({ type: 'date' }), '২০২৬-০৩-০৯', TAB, ROW))).toBe('2026-03-09');
  });

  it('leaves Bengali digits alone in prose columns', () => {
    expect(value(fromCell(col({ type: 'string' }), '৫ নম্বর বিদ্যালয়', TAB, ROW))).toBe(
      '৫ নম্বর বিদ্যালয়',
    );
  });
});

describe('fromCell', () => {
  describe('empty cells', () => {
    it('errors when a required cell is empty, naming the column', () => {
      const e = error(fromCell(col({ type: 'string', required: true, key: 'name' }), '', TAB, ROW));

      expect(e.column).toBe('name');
      expect(e.tab).toBe(TAB);
      expect(e.row).toBe(ROW);
      expect(e.severity).toBe('error');
      expect(e.message).toContain('name');
    });

    it('returns null for an empty optional cell', () => {
      expect(value(fromCell(col({ type: 'string' }), '', TAB, ROW))).toBeNull();
    });
  });

  describe('money', () => {
    it.each([
      ['1500', '1500.00'],
      ['1500.5', '1500.50'],
      ['1500.50', '1500.50'],
      ['-25', '-25.00'],
    ])('accepts %s as %s', (input, expected) => {
      expect(value(fromCell(col({ type: 'money' }), input, TAB, ROW))).toBe(expected);
    });

    // Business-critical: scientific notation must not be silently coerced.
    it.each(['1e2', '1,500', '1500.505', 'abc', '১২৩.৪৫৬'])('rejects %s', (input) => {
      const e = error(fromCell(col({ type: 'money' }), input, TAB, ROW));
      expect(e.column).toBe('amount');
      expect(e.value).toBe(input);
    });
  });

  describe('date', () => {
    it('accepts a real calendar date', () => {
      expect(value(fromCell(col({ type: 'date' }), '2026-03-09', TAB, ROW))).toBe('2026-03-09');
    });

    // new Date('2026-02-30') rolls over to March 2 instead of failing.
    it.each(['2026-02-30', '2026-13-01', '2026-00-10', '09/03/2026', 'yesterday'])(
      'rejects %s',
      (input) => {
        const e = error(fromCell(col({ type: 'date' }), input, TAB, ROW));
        expect(e.value).toBe(input);
        expect(e.column).toBe('amount');
      },
    );

    it('accepts 2028-02-29 because 2028 is a leap year', () => {
      expect(value(fromCell(col({ type: 'date' }), '2028-02-29', TAB, ROW))).toBe('2028-02-29');
    });

    it('converts an Excel serial number to an ISO date', () => {
      // 45000 days after 1899-12-30.
      expect(value(fromCell(col({ type: 'date' }), '45000', TAB, ROW))).toBe('2023-03-15');
    });

    // Business-critical: an out-of-range serial must produce one RowError,
    // not a RangeError that escapes and aborts the whole import.
    it.each(['20260309', '999999999', '0', '-5'])(
      'rejects %s rather than treating it as a serial date',
      (input) => {
        expect(() => fromCell(col({ type: 'date' }), input, TAB, ROW)).not.toThrow();
        expect(error(fromCell(col({ type: 'date' }), input, TAB, ROW)).value).toBe(input);
      },
    );
  });

  describe('datetime', () => {
    it('accepts an ISO timestamp and normalises it to UTC', () => {
      expect(value(fromCell(col({ type: 'datetime' }), '2026-03-09T22:00:00Z', TAB, ROW))).toBe(
        '2026-03-09T22:00:00.000Z',
      );
    });

    it('rejects an unparseable timestamp', () => {
      expect(error(fromCell(col({ type: 'datetime' }), 'not a time', TAB, ROW)).column).toBe(
        'amount',
      );
    });

    // A backup must restore to the same instant wherever it is restored, so
    // a zone-less timestamp is read as UTC rather than as server-local time.
    it('reads a zone-less timestamp as UTC, not server-local time', () => {
      expect(value(fromCell(col({ type: 'datetime' }), '2026-03-09 10:00:00', TAB, ROW))).toBe(
        '2026-03-09T10:00:00.000Z',
      );
    });
  });

  describe('enum', () => {
    const status = col({ type: 'enum', key: 'status', enumValues: ['PAID', 'DUE'] });

    it('accepts an allowed value', () => {
      expect(value(fromCell(status, 'PAID', TAB, ROW))).toBe('PAID');
    });

    it('lists the allowed values in the error message', () => {
      const e = error(fromCell(status, 'SETTLED', TAB, ROW));
      expect(e.message).toContain('PAID, DUE');
      expect(e.value).toBe('SETTLED');
    });
  });

  describe('uuid', () => {
    const id = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';

    it('accepts a v4 uuid', () => {
      expect(value(fromCell(col({ type: 'uuid', key: 'id' }), id, TAB, ROW))).toBe(id);
    });

    it.each(['not-a-uuid', '7f3e4b2a-1c5d-1e8f-9a6b-2d1c3e4f5a6b'])('rejects %s', (input) => {
      expect(error(fromCell(col({ type: 'uuid', key: 'id' }), input, TAB, ROW)).column).toBe('id');
    });
  });

  describe('bool', () => {
    it.each([
      ['TRUE', true],
      ['true', true],
      ['Yes', true],
      ['1', true],
      ['FALSE', false],
      ['no', false],
      ['0', false],
    ])('reads %s as %s', (input, expected) => {
      expect(value(fromCell(col({ type: 'bool' }), input, TAB, ROW))).toBe(expected);
    });

    it('rejects an unrecognised word', () => {
      expect(error(fromCell(col({ type: 'bool' }), 'maybe', TAB, ROW)).value).toBe('maybe');
    });
  });

  describe('json', () => {
    it('parses valid JSON', () => {
      expect(value(fromCell(col({ type: 'json' }), '{"a":1}', TAB, ROW))).toEqual({ a: 1 });
    });

    it('rejects malformed JSON', () => {
      expect(error(fromCell(col({ type: 'json' }), '{a:1}', TAB, ROW)).column).toBe('amount');
    });
  });

  describe('int', () => {
    it('parses a whole number', () => {
      expect(value(fromCell(col({ type: 'int' }), '42', TAB, ROW))).toBe(42);
    });

    it('rejects a decimal', () => {
      expect(error(fromCell(col({ type: 'int' }), '4.2', TAB, ROW)).value).toBe('4.2');
    });
  });

  describe('ref-list', () => {
    it('splits on semicolons and drops blanks', () => {
      expect(value(fromCell(col({ type: 'ref-list' }), 'Six; Seven ;', TAB, ROW))).toEqual([
        'Six',
        'Seven',
      ]);
    });
  });

  it('always names the column and shows the offending value', () => {
    const cases: Array<[ColumnSpec, string]> = [
      [col({ type: 'money' }), 'abc'],
      [col({ type: 'date' }), 'abc'],
      [col({ type: 'int' }), 'abc'],
      [col({ type: 'bool' }), 'abc'],
      [col({ type: 'json' }), 'abc'],
      [col({ type: 'uuid' }), 'abc'],
      [col({ type: 'enum', enumValues: ['A'] }), 'abc'],
    ];

    for (const [spec, raw] of cases) {
      const e = error(fromCell(spec, raw, TAB, ROW));
      expect(e.message).toContain(spec.key);
      expect(e.value).toBe(raw);
    }
  });
});

// Acceptance criterion from the ticket, enforced rather than trusted.
describe('module source', () => {
  it('contains no float arithmetic on money', () => {
    // Comments are stripped first: the module's own docblock explains *why*
    // these are absent, and naming them there must not trip the check.
    const code = readFileSync(join(__dirname, 'cell-format.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(code).not.toContain('parseFloat');
    expect(code).not.toContain('toFixed');
  });
});
