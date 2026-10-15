import type { components } from '@biddaloy/ui/api';
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { buildCommitteeSummary } from './committee-summary';

type Att = components['schemas']['CommitteeAttendanceDto'];
type Fin = components['schemas']['CommitteeFinanceDto'];

const config = REGION_BD_EN;
// Echo the key and interpolation values so each rule is asserted by key.
const t = ((key: string, o: Record<string, string | undefined> = {}) =>
  [key.replace('committeeSummary.', ''), o.gap, o.diff, o.percent, o.first, o.second]
    .filter((v) => v !== undefined)
    .join('|')) as unknown as TFunction;

const att = (current: number | null): Att => ({
  months: [],
  current_month_percentage: current,
  year_percentage: 88,
  target_percentage: 90,
});
const fin = (pct: number | null, lastYear: number | null | 'none'): Fin => ({
  months: [],
  year_outstanding: 0,
  current_month: {
    as_of: '2026-10-07',
    received: 0,
    billed_for_month: 0,
    received_pct: pct,
    month: '2026-10',
    last_month_same_point: { as_of: '', received: 0, billed_for_month: 0, received_pct: null },
    last_year_same_point:
      lastYear === 'none'
        ? null
        : { as_of: '', received: 0, billed_for_month: 0, received_pct: lastYear },
  },
});

describe('buildCommitteeSummary', () => {
  it('attendance: met, near, below with the gap', () => {
    expect(buildCommitteeSummary(att(91), undefined, t, config)).toBe('AttendanceMet.');
    expect(buildCommitteeSummary(att(89), undefined, t, config)).toBe('AttendanceNear.');
    expect(buildCommitteeSummary(att(80), undefined, t, config)).toBe('AttendanceBelow|10%.');
  });

  it('collection: up / down / same / no last year', () => {
    expect(buildCommitteeSummary(undefined, fin(70, 62), t, config)).toBe('CollectionUp|8%.');
    expect(buildCommitteeSummary(undefined, fin(60, 62), t, config)).toBe('CollectionDown|2%.');
    expect(buildCommitteeSummary(undefined, fin(62, 62.4), t, config)).toBe('CollectionSame.');
    expect(buildCommitteeSummary(undefined, fin(70, 'none'), t, config)).toBe(
      'CollectionNoLastYear|70%.',
    );
  });

  it('joins two clauses; a missing clause is left out; none gives null', () => {
    expect(buildCommitteeSummary(att(91), fin(70, 62), t, config)).toBe(
      'Joiner|attendanceMet|collectionUp|8%.',
    );
    expect(buildCommitteeSummary(att(null), fin(null, null), t, config)).toBeNull();
    expect(buildCommitteeSummary(undefined, undefined, t, config)).toBeNull();
  });
});
