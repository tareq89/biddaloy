import { describe, expect, it } from 'vitest';

import {
  applyLineEdit,
  classifyAllocationType,
  prefillFifoAllocations,
  relockFifo,
  summarizeAllocation,
  willFullyPayAllTouchedFees,
  type AllocationLine,
  type OutstandingFee,
} from './allocation-math';

const TODAY = new Date('2026-03-15T00:00:00.000Z');

describe('classifyAllocationType', () => {
  it('classifies a past month as DUE', () => {
    expect(classifyAllocationType({ month: 2, year: 2026 }, TODAY)).toBe('DUE');
  });

  it('classifies a past year as DUE regardless of month', () => {
    expect(classifyAllocationType({ month: 12, year: 2025 }, TODAY)).toBe('DUE');
  });

  it('classifies the current month as CURRENT', () => {
    expect(classifyAllocationType({ month: 3, year: 2026 }, TODAY)).toBe('CURRENT');
  });

  it('classifies a future month as ADVANCE', () => {
    expect(classifyAllocationType({ month: 4, year: 2026 }, TODAY)).toBe('ADVANCE');
  });

  it('classifies a future year as ADVANCE regardless of month', () => {
    expect(classifyAllocationType({ month: 1, year: 2027 }, TODAY)).toBe('ADVANCE');
  });
});

describe('prefillFifoAllocations', () => {
  const fees: OutstandingFee[] = [
    { id: 'jan', month: 1, year: 2026, remainingMinorUnits: 100000 },
    { id: 'feb', month: 2, year: 2026, remainingMinorUnits: 100000 },
    { id: 'mar', month: 3, year: 2026, remainingMinorUnits: 100000 },
  ];

  it('fills the oldest fee first, in full, when the amount covers it exactly', () => {
    const lines = prefillFifoAllocations(fees, 100000, TODAY);
    expect(lines[0]).toMatchObject({
      studentFeeId: 'jan',
      allocatedMinorUnits: 100000,
      locked: false,
    });
    expect(lines[1]).toMatchObject({ studentFeeId: 'feb', allocatedMinorUnits: 0, locked: false });
    expect(lines[2]).toMatchObject({ studentFeeId: 'mar', allocatedMinorUnits: 0, locked: true });
  });

  it('spills over into the next fee once the current one is fully paid', () => {
    const lines = prefillFifoAllocations(fees, 150000, TODAY);
    expect(lines[0]!.allocatedMinorUnits).toBe(100000);
    expect(lines[1]!.allocatedMinorUnits).toBe(50000);
    expect(lines[1]!.locked).toBe(false);
    expect(lines[2]).toMatchObject({ allocatedMinorUnits: 0, locked: true });
  });

  it('fills every fee in full when the amount covers all of them exactly', () => {
    const lines = prefillFifoAllocations(fees, 300000, TODAY);
    expect(lines.every((line) => line.allocatedMinorUnits === 100000)).toBe(true);
    expect(lines.every((line) => !line.locked)).toBe(true);
  });

  it('locks every later fee once an earlier one is only partially paid', () => {
    const lines = prefillFifoAllocations(fees, 50000, TODAY);
    expect(lines[0]).toMatchObject({ allocatedMinorUnits: 50000, locked: false });
    expect(lines[1]).toMatchObject({ allocatedMinorUnits: 0, locked: true });
    expect(lines[2]).toMatchObject({ allocatedMinorUnits: 0, locked: true });
  });

  it('allocates nothing when the amount is zero', () => {
    const lines = prefillFifoAllocations(fees, 0, TODAY);
    expect(lines.every((line) => line.allocatedMinorUnits === 0)).toBe(true);
    expect(lines[0]!.locked).toBe(false);
    expect(lines[1]!.locked).toBe(true);
  });

  it('sorts by year then month regardless of input order', () => {
    const outOfOrder: OutstandingFee[] = [
      { id: 'mar', month: 3, year: 2026, remainingMinorUnits: 100000 },
      { id: 'jan-2025', month: 12, year: 2025, remainingMinorUnits: 100000 },
      { id: 'feb', month: 2, year: 2026, remainingMinorUnits: 100000 },
    ];
    const lines = prefillFifoAllocations(outOfOrder, 300000, TODAY);
    expect(lines.map((line) => line.studentFeeId)).toEqual(['jan-2025', 'feb', 'mar']);
  });

  it('assigns the correct allocation_type per line', () => {
    const lines = prefillFifoAllocations(fees, 300000, TODAY);
    expect(lines[0]!.allocationType).toBe('DUE');
    expect(lines[1]!.allocationType).toBe('DUE');
    expect(lines[2]!.allocationType).toBe('CURRENT');
  });

  it('returns no lines for no outstanding fees', () => {
    expect(prefillFifoAllocations([], 100000, TODAY)).toEqual([]);
  });
});

describe('applyLineEdit', () => {
  function buildLines(): AllocationLine[] {
    return prefillFifoAllocations(
      [
        { id: 'jan', month: 1, year: 2026, remainingMinorUnits: 100000 },
        { id: 'feb', month: 2, year: 2026, remainingMinorUnits: 100000 },
        { id: 'mar', month: 3, year: 2026, remainingMinorUnits: 100000 },
      ],
      300000,
      TODAY,
    );
  }

  it('clamps an edit above the fee’s remaining balance', () => {
    const lines = applyLineEdit(buildLines(), 'jan', 999999999);
    expect(lines[0]!.allocatedMinorUnits).toBe(100000);
  });

  it('clamps a negative edit to zero', () => {
    const lines = applyLineEdit(buildLines(), 'jan', -500);
    expect(lines[0]!.allocatedMinorUnits).toBe(0);
  });

  it('locks and zeroes every later line once an earlier line is edited down', () => {
    const lines = applyLineEdit(buildLines(), 'jan', 40000);
    expect(lines[0]).toMatchObject({ allocatedMinorUnits: 40000, locked: false });
    expect(lines[1]).toMatchObject({ allocatedMinorUnits: 0, locked: true });
    expect(lines[2]).toMatchObject({ allocatedMinorUnits: 0, locked: true });
  });

  it('unlocks later lines again once an earlier line is edited back up to full', () => {
    const shortfall = applyLineEdit(buildLines(), 'jan', 40000);
    const restored = applyLineEdit(shortfall, 'jan', 100000);
    expect(restored[0]).toMatchObject({ allocatedMinorUnits: 100000, locked: false });
    expect(restored[1]!.locked).toBe(false);
  });

  it('does not change a locked line’s amount even if the caller tries to edit it', () => {
    const shortfall = applyLineEdit(buildLines(), 'jan', 40000);
    const edited = applyLineEdit(shortfall, 'feb', 60000);
    expect(edited[1]).toMatchObject({ allocatedMinorUnits: 0, locked: true });
  });
});

describe('relockFifo', () => {
  it('is idempotent on an already-consistent set of lines', () => {
    const lines = prefillFifoAllocations(
      [
        { id: 'jan', month: 1, year: 2026, remainingMinorUnits: 100000 },
        { id: 'feb', month: 2, year: 2026, remainingMinorUnits: 100000 },
      ],
      150000,
      TODAY,
    );
    expect(relockFifo(lines)).toEqual(lines);
  });
});

describe('summarizeAllocation', () => {
  it('reports allocated and unallocated amounts', () => {
    const lines = prefillFifoAllocations(
      [{ id: 'jan', month: 1, year: 2026, remainingMinorUnits: 100000 }],
      100000,
      TODAY,
    );
    expect(summarizeAllocation(lines, 150000)).toEqual({
      allocatedMinorUnits: 100000,
      unallocatedMinorUnits: 50000,
      overAllocated: false,
    });
  });

  it('flags over-allocation when lines sum past the total amount', () => {
    const lines: AllocationLine[] = [
      {
        studentFeeId: 'jan',
        month: 1,
        year: 2026,
        remainingMinorUnits: 200000,
        allocationType: 'DUE',
        allocatedMinorUnits: 150000,
        locked: false,
      },
    ];
    expect(summarizeAllocation(lines, 100000)).toEqual({
      allocatedMinorUnits: 150000,
      unallocatedMinorUnits: -50000,
      overAllocated: true,
    });
  });
});

describe('willFullyPayAllTouchedFees', () => {
  it('is false when no line has any allocation', () => {
    const lines = prefillFifoAllocations(
      [{ id: 'jan', month: 1, year: 2026, remainingMinorUnits: 100000 }],
      0,
      TODAY,
    );
    expect(willFullyPayAllTouchedFees(lines)).toBe(false);
  });

  it('is true when every touched fee is paid off in full', () => {
    const lines = prefillFifoAllocations(
      [
        { id: 'jan', month: 1, year: 2026, remainingMinorUnits: 100000 },
        { id: 'feb', month: 2, year: 2026, remainingMinorUnits: 100000 },
      ],
      200000,
      TODAY,
    );
    expect(willFullyPayAllTouchedFees(lines)).toBe(true);
  });

  it('is false when the touched fee is only partially paid', () => {
    const lines = prefillFifoAllocations(
      [{ id: 'jan', month: 1, year: 2026, remainingMinorUnits: 100000 }],
      50000,
      TODAY,
    );
    expect(willFullyPayAllTouchedFees(lines)).toBe(false);
  });

  it('ignores untouched fees when deciding full payment', () => {
    const lines = prefillFifoAllocations(
      [
        { id: 'jan', month: 1, year: 2026, remainingMinorUnits: 100000 },
        { id: 'feb', month: 2, year: 2026, remainingMinorUnits: 100000 },
      ],
      100000,
      TODAY,
    );
    // "jan" is fully paid, "feb" was never touched (locked, zero) — this
    // should still count as a full payment of the fee it actually touched.
    expect(willFullyPayAllTouchedFees(lines)).toBe(true);
  });
});
