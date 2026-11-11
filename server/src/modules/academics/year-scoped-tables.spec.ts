import { describe, it, expect } from 'vitest';
import { YEAR_SCOPED_WRITES } from '../../common/utils/year-open.guard';
import { YEAR_SCOPED_TABLES } from './academic-year.service';

describe('YEAR_SCOPED_TABLES', () => {
  // A registry entry without a table would silently drop out of the close preview's freezes.
  it('has a table for every YEAR_SCOPED_WRITES entity except AttendanceRecord', () => {
    const missing = YEAR_SCOPED_WRITES.map((w) => w.entity).filter(
      (e) => e !== 'AttendanceRecord' && !YEAR_SCOPED_TABLES[e],
    );
    expect(missing).toEqual([]);
  });
});
