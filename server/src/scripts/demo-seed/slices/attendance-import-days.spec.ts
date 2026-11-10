import { importDays } from './attendance';

// PR #3609 review: the sheet's days on a short year (early-year anchor), no database needed.
// Lives in its own unit spec: inside attendance.integration.spec.ts the per-test DB reset ran
// after the 3-year demo dataset and timed out (30 s), failing this pure test on every main push.
describe('importDays', () => {
  const days = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];

  it('enough history: the `need` days ending 3 school days back', () => {
    expect(importDays(days, 3)).toEqual(['d2', 'd3', 'd4']);
  });

  it('short history: the latest days the year has, so the sheet is not dropped', () => {
    expect(importDays(['d1', 'd2'], 3)).toEqual(['d1', 'd2']);
    expect(importDays(['d1'], 20)).toEqual(['d1']);
  });

  it("the year's first school day (nothing before it): no days, no sheet", () => {
    expect(importDays([], 3)).toEqual([]);
  });
});
