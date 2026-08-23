/**
 * Pure FIFO allocation math for [8.10.5]'s Record Payment wizard — no DOM,
 * no React, no API client. Everything here works in integer minor units
 * (paisa), never a float or a server decimal string, for the same reason
 * `ui/src/utils/currency.ts`'s header comment gives: money arithmetic on
 * floats or strings silently drifts.
 *
 * Mirrors two pieces of server logic on purpose, since the server rejects
 * any allocation that disagrees with them (`payment-allocation.service.ts`):
 * - `classifyAllocationType` mirrors the server's private `classifyPeriod`
 *   (DUE/CURRENT/ADVANCE by fee month/year vs. today).
 * - the FIFO "locked" rule mirrors the server's `blocked` flag: once an
 *   earlier-dated fee doesn't receive its full remaining balance, no
 *   later-dated fee may receive anything.
 * If the server's rule ever changes, this needs to change with it — there
 * is no shared source of truth between the two today.
 */

export type AllocationType = 'DUE' | 'CURRENT' | 'ADVANCE';

export interface OutstandingFee {
  id: string;
  month: number;
  year: number;
  /** `total_amount - paid_amount - discount_amount`, already rounded and
   * converted to minor units by the caller (`serverAmountToMinorUnits`). */
  remainingMinorUnits: number;
}

export interface AllocationLine {
  studentFeeId: string;
  month: number;
  year: number;
  remainingMinorUnits: number;
  allocationType: AllocationType;
  allocatedMinorUnits: number;
  /** `true` when an earlier-dated line isn't fully allocated, which under
   * FIFO blocks this line from receiving anything — the UI disables
   * editing while this is `true`. */
  locked: boolean;
}

export interface AllocationSummary {
  allocatedMinorUnits: number;
  unallocatedMinorUnits: number;
  overAllocated: boolean;
}

export function classifyAllocationType(
  fee: { month: number; year: number },
  today: Date = new Date(),
): AllocationType {
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  if (fee.year < currentYear || (fee.year === currentYear && fee.month < currentMonth)) {
    return 'DUE';
  }
  if (fee.year === currentYear && fee.month === currentMonth) {
    return 'CURRENT';
  }
  return 'ADVANCE';
}

/** Oldest first — matches the server's `ORDER BY sf.year ASC, sf.month ASC`. */
export function sortFifo<T extends { month: number; year: number }>(fees: readonly T[]): T[] {
  return [...fees].sort((a, b) => a.year - b.year || a.month - b.month);
}

/** Greedy FIFO fill of `totalMinorUnits` across `outstandingFees`, oldest
 * fee first, stopping (and locking every later line) at the first fee that
 * can't be paid off in full with what's left. */
export function prefillFifoAllocations(
  outstandingFees: readonly OutstandingFee[],
  totalMinorUnits: number,
  today: Date = new Date(),
): AllocationLine[] {
  const sorted = sortFifo(outstandingFees);
  let remainingToAllocate = Math.max(0, totalMinorUnits);
  let fifoBroken = false;
  const lines: AllocationLine[] = [];

  for (const fee of sorted) {
    const locked = fifoBroken;
    const allocatedMinorUnits = locked ? 0 : Math.min(fee.remainingMinorUnits, remainingToAllocate);
    remainingToAllocate -= allocatedMinorUnits;
    if (allocatedMinorUnits < fee.remainingMinorUnits) {
      fifoBroken = true;
    }
    lines.push({
      studentFeeId: fee.id,
      month: fee.month,
      year: fee.year,
      remainingMinorUnits: fee.remainingMinorUnits,
      allocationType: classifyAllocationType(fee, today),
      allocatedMinorUnits,
      locked,
    });
  }

  return lines;
}

/** Re-derives every line's `locked` flag, and zeroes any line that just
 * became locked, from the lines' current (possibly hand-edited)
 * `allocatedMinorUnits` — the FIFO invariant, re-applied after an edit
 * instead of only at prefill time. Line order is assumed already FIFO
 * (unchanged from `prefillFifoAllocations`). */
export function relockFifo(lines: readonly AllocationLine[]): AllocationLine[] {
  let fifoBroken = false;
  return lines.map((line) => {
    const locked = fifoBroken;
    const allocatedMinorUnits = locked ? 0 : line.allocatedMinorUnits;
    if (allocatedMinorUnits < line.remainingMinorUnits) {
      fifoBroken = true;
    }
    return { ...line, allocatedMinorUnits, locked };
  });
}

/** Applies one line's hand-edited amount (clamped to `[0, remaining]`) and
 * re-locks every line that follows it in FIFO order. Editing a locked line
 * is a caller error (the UI disables its input) — this clamps rather than
 * throwing, since a stale event handler firing after a re-render is more
 * likely than deliberate misuse. */
export function applyLineEdit(
  lines: readonly AllocationLine[],
  studentFeeId: string,
  newAmountMinorUnits: number,
): AllocationLine[] {
  const edited = lines.map((line) =>
    line.studentFeeId === studentFeeId
      ? {
          ...line,
          allocatedMinorUnits: Math.max(0, Math.min(newAmountMinorUnits, line.remainingMinorUnits)),
        }
      : line,
  );
  return relockFifo(edited);
}

export function summarizeAllocation(
  lines: readonly AllocationLine[],
  totalMinorUnits: number,
): AllocationSummary {
  const allocatedMinorUnits = lines.reduce((sum, line) => sum + line.allocatedMinorUnits, 0);
  return {
    allocatedMinorUnits,
    unallocatedMinorUnits: totalMinorUnits - allocatedMinorUnits,
    overAllocated: allocatedMinorUnits > totalMinorUnits,
  };
}

/** Whether submitting the current allocation as-is would fully pay off
 * every fee it touches — the server only generates an invoice
 * (`payment-allocation.service.ts`'s `isFullPayment`) when every allocated
 * fee reaches `PAID`, not merely when the payment as a whole is "full". */
export function willFullyPayAllTouchedFees(lines: readonly AllocationLine[]): boolean {
  const touched = lines.filter((line) => line.allocatedMinorUnits > 0);
  return (
    touched.length > 0 &&
    touched.every((line) => line.allocatedMinorUnits >= line.remainingMinorUnits)
  );
}
