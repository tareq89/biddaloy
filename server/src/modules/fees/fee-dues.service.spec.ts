import { describe, it, expect } from 'vitest';
import { sortAggregates, decodeMonthOrdinal, StudentDueAggregate } from './fee-dues.service';

/**
 * Unit tests for the pure sorting helper used by FeeDuesService.getDues.
 * The SQL-aggregation and pagination behavior is covered by
 * fee-dues.service.integration.spec.ts against a real database, since it
 * exercises TypeORM query-builder SQL that isn't meaningful to mock.
 */

describe('sortAggregates', () => {
  function makeAggregate(overrides: Partial<StudentDueAggregate> = {}): StudentDueAggregate {
    return {
      student_id: 'id',
      full_name: 'Name',
      registration_number: 'REG-1',
      roll_number: 1,
      class_name: 'Class One',
      section_name: 'Section A',
      total_due: 0,
      months_overdue: 0,
      ...overrides,
    };
  }

  it('sorts by due_amount descending', () => {
    const low = makeAggregate({ student_id: 'low', total_due: 100 });
    const high = makeAggregate({ student_id: 'high', total_due: 900 });

    const result = sortAggregates([low, high], 'due_amount', 'DESC');

    expect(result.map((r) => r.student_id)).toEqual(['high', 'low']);
  });

  it('sorts by due_amount ascending', () => {
    const low = makeAggregate({ student_id: 'low', total_due: 100 });
    const high = makeAggregate({ student_id: 'high', total_due: 900 });

    const result = sortAggregates([high, low], 'due_amount', 'ASC');

    expect(result.map((r) => r.student_id)).toEqual(['low', 'high']);
  });

  it('sorts by name case-insensitively via localeCompare', () => {
    const zoe = makeAggregate({ student_id: 'zoe', full_name: 'Zoe' });
    const aaron = makeAggregate({ student_id: 'aaron', full_name: 'Aaron' });

    const result = sortAggregates([zoe, aaron], 'name', 'ASC');

    expect(result.map((r) => r.student_id)).toEqual(['aaron', 'zoe']);
  });

  it('sorts by class, treating a null class_name as an empty string', () => {
    const withClass = makeAggregate({ student_id: 'has-class', class_name: 'Class One' });
    const withoutClass = makeAggregate({ student_id: 'no-class', class_name: null });

    const result = sortAggregates([withClass, withoutClass], 'class', 'ASC');

    expect(result.map((r) => r.student_id)).toEqual(['no-class', 'has-class']);
  });

  it('breaks ties on student_id for a deterministic order across requests', () => {
    const b = makeAggregate({ student_id: 'b', total_due: 100 });
    const a = makeAggregate({ student_id: 'a', total_due: 100 });

    const result = sortAggregates([b, a], 'due_amount', 'DESC');

    expect(result.map((r) => r.student_id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const input = [makeAggregate({ student_id: 'b', total_due: 2 }), makeAggregate({ student_id: 'a', total_due: 1 })];
    const originalOrder = input.map((r) => r.student_id);

    sortAggregates(input, 'due_amount', 'ASC');

    expect(input.map((r) => r.student_id)).toEqual(originalOrder);
  });
});

/**
 * getDueSnapshots collapses (year, month) into one sortable integer so
 * Postgres can MIN it; this expands it back. The SQL half is covered in
 * fee-dues.service.integration.spec.ts against a real database.
 */
describe('decodeMonthOrdinal', () => {
  function encode(month: number, year: number) {
    return year * 12 + month - 1;
  }

  it('round-trips every month of a year', () => {
    for (let month = 1; month <= 12; month++) {
      expect(decodeMonthOrdinal(encode(month, 2026))).toEqual({ month, year: 2026 });
    }
  });

  it('keeps December and the following January in the right years', () => {
    expect(decodeMonthOrdinal(encode(12, 2025))).toEqual({ month: 12, year: 2025 });
    expect(decodeMonthOrdinal(encode(1, 2026))).toEqual({ month: 1, year: 2026 });
  });

  it('orders December 2025 before January 2026, which is why the encoding works', () => {
    expect(encode(12, 2025)).toBeLessThan(encode(1, 2026));
  });
});
