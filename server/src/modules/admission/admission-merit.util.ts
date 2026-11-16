/**
 * [71.G2.05, D23] Pure merit order for an admission stage, cloned from
 * `promotions/placement.ts` `meritOrder`. No database, no DI.
 */

export type TieBreakKey = 'DOB' | 'APPLIED_AT' | 'ID';
/** D23 default: score desc, then older date of birth, earlier application, then id. */
export const DEFAULT_TIE_BREAK: readonly TieBreakKey[] = ['DOB', 'APPLIED_AT', 'ID'];
export const TIE_BREAK_KEYS: readonly TieBreakKey[] = DEFAULT_TIE_BREAK;

export interface MeritRow {
  applicant_id: string;
  /** Whole hundredths (12.34 -> 1234), never a float. */
  score_hundredths: number;
  /** YYYY-MM-DD */
  date_of_birth: string;
  /** ISO timestamp (compared as a string, same zone from the DB) */
  created_at: string;
}

export interface RankedMeritRow extends MeritRow {
  merit_rank: number;
}

/** "12.34" or 12.34 -> 1234. Null when it is not a number with at most 2 decimals. */
export function toHundredths(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (!/^-?\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  const cents =
    Number(whole) * 100 + (whole.startsWith('-') ? -1 : 1) * Number(frac.padEnd(2, '0'));
  return cents;
}

/** The stage's configured tie-break when valid, else the D23 default. */
export function resolveTieBreak(
  config: Record<string, unknown> | null | undefined,
): readonly TieBreakKey[] {
  const configured = config?.tie_break;
  if (
    Array.isArray(configured) &&
    configured.length > 0 &&
    configured.every((k) => TIE_BREAK_KEYS.includes(k as TieBreakKey))
  )
    return configured as TieBreakKey[];
  return DEFAULT_TIE_BREAK;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Higher score first; every tie-break key in order; `applicant_id` last so a full tie is stable. */
export function meritOrder(
  rows: MeritRow[],
  tieBreak: readonly TieBreakKey[] = DEFAULT_TIE_BREAK,
): RankedMeritRow[] {
  const keys = tieBreak.includes('ID') ? tieBreak : [...tieBreak, 'ID' as const];
  const sorted = [...rows].sort((a, b) => {
    if (b.score_hundredths !== a.score_hundredths) return b.score_hundredths - a.score_hundredths;
    for (const key of keys) {
      const d =
        key === 'DOB'
          ? cmp(a.date_of_birth, b.date_of_birth)
          : key === 'APPLIED_AT'
            ? cmp(a.created_at, b.created_at)
            : cmp(a.applicant_id, b.applicant_id);
      if (d !== 0) return d;
    }
    return 0;
  });
  return sorted.map((row, index) => ({ ...row, merit_rank: index + 1 }));
}
