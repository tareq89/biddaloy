/**
 * [100.1.03] Pure draw planning for credit lots: no database, so the ordering rules are
 * tested without one. Counts are whole units (Rule 26 spirit).
 */
export interface PlanLot {
  id: string;
  remaining: number;
  debited_units: number;
  expires_at: Date | null;
  created_at: Date;
}

export interface PlanPart {
  lotId: string;
  units: number;
}

const isPositiveInt = (n: number): boolean => Number.isInteger(n) && n > 0;

/** Earliest expiry first, no-expiry last, ties by creation order. Returns a new array. */
export function sortByExpiry<T extends { expires_at: Date | null; created_at: Date }>(
  lots: readonly T[],
): T[] {
  return [...lots].sort((a, b) => {
    const ax = a.expires_at?.getTime() ?? Infinity;
    const bx = b.expires_at?.getTime() ?? Infinity;
    if (ax !== bx) return ax < bx ? -1 : 1;
    return a.created_at.getTime() - b.created_at.getTime();
  });
}

/** A lot can be drawn from when it has units left and has not passed its expiry. */
export function isUsable(lot: PlanLot, now: Date): boolean {
  return lot.remaining > 0 && (lot.expires_at === null || lot.expires_at.getTime() > now.getTime());
}

export function usableSum(lots: readonly PlanLot[], now: Date): number {
  return lots.reduce((sum, l) => (isUsable(l, now) ? sum + l.remaining : sum), 0);
}

/** Splits `units` over the usable lots, earliest expiry first. `null` when short or invalid. */
export function planDraw(lots: readonly PlanLot[], units: number, now: Date): PlanPart[] | null {
  if (!isPositiveInt(units)) return null;
  const parts: PlanPart[] = [];
  let need = units;
  for (const lot of sortByExpiry(lots.filter((l) => isUsable(l, now)))) {
    if (need === 0) break;
    const take = Math.min(lot.remaining, need);
    parts.push({ lotId: lot.id, units: take });
    need -= take;
  }
  return need === 0 ? parts : null;
}

/**
 * Splits a refund over lots that have debited units, earliest expiry first. The caller
 * passes only lots that are not expired. Whatever no lot has room for is `leftover`.
 */
export function planReturn(
  lots: readonly PlanLot[],
  units: number,
): { parts: PlanPart[]; leftover: number } {
  if (!isPositiveInt(units)) return { parts: [], leftover: 0 };
  const parts: PlanPart[] = [];
  let need = units;
  for (const lot of sortByExpiry(lots.filter((l) => l.debited_units > 0))) {
    if (need === 0) break;
    const take = Math.min(lot.debited_units, need);
    parts.push({ lotId: lot.id, units: take });
    need -= take;
  }
  return { parts, leftover: need };
}
