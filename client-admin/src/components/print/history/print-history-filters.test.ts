import { describe, expect, it } from 'vitest';

import {
  filterValues,
  printHistorySearchSchema,
  toHistoryFilters,
  type PrintHistorySearch,
} from './print-history-filters';

const parse = (input: unknown) => printHistorySearchSchema.parse(input);

describe('printHistorySearchSchema', () => {
  it('accepts a full, valid search', () => {
    const search = parse({
      page: 2,
      limit: 50,
      document_kind: 'STUDENT_ID_CARD',
      template_id: 't-1',
      printed_by: 'u-1',
      from: '2027-01-31',
      to: '2027-02-28',
      outcome: 'FAILED',
      revoked: 'true',
      q: 'rahim',
    });
    expect(search).toMatchObject({ page: 2, limit: 50, outcome: 'FAILED', revoked: 'true' });
  });

  it('turns every bad value into "no filter" instead of throwing', () => {
    const search = parse({
      page: -1,
      limit: 5000,
      document_kind: 'NOPE',
      from: '2027-02-30', // not a real day
      to: 'yesterday',
      outcome: 'MAYBE',
      revoked: 'yes',
    });
    expect(Object.values(search).every((v) => v === undefined)).toBe(true);
  });

  it('accepts a leap day and rejects a non-leap one', () => {
    expect(parse({ from: '2028-02-29' }).from).toBe('2028-02-29');
    expect(parse({ from: '2027-02-29' }).from).toBeUndefined();
  });
});

describe('filterValues', () => {
  it('keeps only the filter keys that are set (not paging)', () => {
    const search: PrintHistorySearch = { page: 3, limit: 10, outcome: 'OK', q: 'x' };
    expect(filterValues(search)).toEqual({ outcome: 'OK', q: 'x' });
    expect(filterValues({})).toEqual({});
  });
});

describe('toHistoryFilters', () => {
  it('defaults paging and sends nothing else for an empty search', () => {
    expect(toHistoryFilters({})).toEqual({ page: 1, limit: 10 });
  });

  it('passes every filter through, turning revoked into a boolean', () => {
    expect(
      toHistoryFilters({
        page: 4,
        limit: 25,
        document_kind: 'STAFF_ID_CARD',
        template_id: 't',
        printed_by: 'u',
        from: '2027-01-01',
        to: '2027-01-31',
        outcome: 'PENDING',
        revoked: 'false',
        q: 'abc',
      }),
    ).toEqual({
      page: 4,
      limit: 25,
      document_kind: 'STAFF_ID_CARD',
      template_id: 't',
      printed_by: 'u',
      from: '2027-01-01',
      to: '2027-01-31',
      outcome: 'PENDING',
      revoked: false,
      q: 'abc',
    });
    expect(toHistoryFilters({ revoked: 'true' }).revoked).toBe(true);
  });

  it('does not send an empty search text', () => {
    expect(toHistoryFilters({ q: '' })).not.toHaveProperty('q');
  });
});
