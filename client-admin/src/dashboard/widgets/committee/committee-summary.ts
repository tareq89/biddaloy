/**
 * [8.10.7.5.02] The committee's one-sentence summary (D47). Pure: the dashboard
 * banner and the printed report both call it. Totals only, nothing personal.
 */
import type { components } from '@biddaloy/ui/api';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import type { TFunction } from 'i18next';

type Attendance = components['schemas']['CommitteeAttendanceDto'];
type Finance = components['schemas']['CommitteeFinanceDto'];
type T = TFunction;

const NEAR_POINTS = 3;
const SAME_POINTS = 1;

export function buildCommitteeSummary(
  attendance: Attendance | undefined,
  finance: Finance | undefined,
  t: T,
  config: RegionConfig,
): string | null {
  const s = (key: string, opts: Record<string, unknown> = {}) => t(`committeeSummary.${key}`, opts);
  const pct = (v: number) => `${formatNumber(v, config)}%`;

  let a: string | null = null;
  if (attendance && attendance.current_month_percentage != null) {
    const gap = attendance.target_percentage - attendance.current_month_percentage;
    a = gap <= 0 ? s('attendanceMet') : gap <= NEAR_POINTS ? s('attendanceNear') : null;
    a ??= s('attendanceBelow', { gap: pct(Math.round(gap * 10) / 10) });
  }

  let c: string | null = null;
  const now = finance?.current_month.received_pct;
  if (now != null) {
    const last = finance?.current_month.last_year_same_point?.received_pct;
    if (last == null) c = s('collectionNoLastYear', { percent: pct(now) });
    else {
      const diff = now - last;
      c =
        Math.abs(diff) < SAME_POINTS
          ? s('collectionSame')
          : s(diff > 0 ? 'collectionUp' : 'collectionDown', {
              diff: pct(Math.round(Math.abs(diff))),
            });
    }
  }

  const text = a && c ? s('joiner', { first: a, second: c }) : (a ?? c);
  if (!text) return null;
  // The collection clauses start lower-case and the attendance ones have no full stop.
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return sentence.endsWith('.') ? sentence : `${sentence}.`;
}
