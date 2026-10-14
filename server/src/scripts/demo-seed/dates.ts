/** All helpers derive from the anchor (YYYY-MM-DD); no literal years anywhere (22-demo-seed.md). */

export type TenantKind = 'PRIMARY' | 'HIGH' | 'COLLEGE';

export interface YearSpan {
  name: string;
  start: string;
  end: string;
}

/**
 * `years` academic years ending with the one that contains the anchor.
 * Primary and High run Jan-Dec; College runs Jul-Jun (D32).
 */
export function academicYears(kind: TenantKind, years: number, anchor: string): YearSpan[] {
  const y = Number(anchor.slice(0, 4));
  const m = Number(anchor.slice(5, 7));
  const out: YearSpan[] = [];
  if (kind === 'COLLEGE') {
    const last = m >= 7 ? y : y - 1;
    for (let s = last - years + 1; s <= last; s++) {
      out.push({ name: `${s}-${s + 1}`, start: `${s}-07-01`, end: `${s + 1}-06-30` });
    }
  } else {
    for (let s = y - years + 1; s <= y; s++) {
      out.push({ name: `${s}`, start: `${s}-01-01`, end: `${s}-12-31` });
    }
  }
  return out;
}

/** Every date from..to (inclusive) that is not a weekly off-day (0=Sun..5=Fri) or a holiday. */
export function schoolDays(
  from: string,
  to: string,
  weeklyOff: number[] = [5],
  holidays: Iterable<string> = [],
): string[] {
  const off = new Set(holidays);
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
    const d = new Date(t);
    const iso = d.toISOString().slice(0, 10);
    if (!weeklyOff.includes(d.getUTCDay()) && !off.has(iso)) out.push(iso);
  }
  return out;
}

/** The anchor day at hh:mm in Asia/Dhaka (UTC+6, no DST), as a Date. */
export function todayAt(anchor: string, hh: number, mm = 0): Date {
  const p = (n: number) => String(n).padStart(2, '0');
  return new Date(`${anchor}T${p(hh)}:${p(mm)}:00+06:00`);
}
