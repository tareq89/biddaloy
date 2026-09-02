/** [8.14.6] Guard: every paginated list query-option factory must opt into
 * `placeholderData: keepPreviousData` (TanStack Query v5's replacement for
 * the removed `keepPreviousData: true` option). Without it, a filter/page/
 * sort change unmounts every row into a single-line "Loading…" cell instead
 * of keeping the previous page's rows on screen while the next page loads.
 *
 * This is a table-driven regression guard, not a behavioural test — see
 * `students.test.tsx`'s "keeps previous rows while refetching a filter
 * change" test for the actual keep-previous-data behaviour under MSW. */
import { keepPreviousData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
  academicYearsQueryOptions,
  auditLogsQueryOptions,
  classesQueryOptions,
  feeDuesQueryOptions,
  feeStructuresQueryOptions,
  guardiansQueryOptions,
  invoicesQueryOptions,
  reminderBatchesQueryOptions,
  reminderBatchLogsQueryOptions,
  studentsQueryOptions,
  usersQueryOptions,
} from './index';

describe('list query-option factories carry placeholderData: keepPreviousData', () => {
  it.each([
    ['studentsQueryOptions', () => studentsQueryOptions()],
    ['classesQueryOptions', () => classesQueryOptions()],
    ['guardiansQueryOptions', () => guardiansQueryOptions({})],
    ['academicYearsQueryOptions', () => academicYearsQueryOptions()],
    ['feeStructuresQueryOptions', () => feeStructuresQueryOptions()],
    ['invoicesQueryOptions', () => invoicesQueryOptions()],
    ['auditLogsQueryOptions', () => auditLogsQueryOptions()],
    ['usersQueryOptions', () => usersQueryOptions({})],
    ['feeDuesQueryOptions', () => feeDuesQueryOptions()],
    ['reminderBatchesQueryOptions', () => reminderBatchesQueryOptions()],
    ['reminderBatchLogsQueryOptions', () => reminderBatchLogsQueryOptions('batch-1')],
  ] as const)('%s', (_name, buildOptions) => {
    expect(buildOptions().placeholderData).toBe(keepPreviousData);
  });
});
