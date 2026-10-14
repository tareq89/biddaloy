import type { EntityManager } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateCreditNoteNumber, generateInvoiceNumber } from './invoice-numbering.util';

// nextTenantSerial runs two queries: the advisory lock, then the max+1 lookup.
function fakeManager(next = 1) {
  const query = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ n: next }]);
  return { manager: { query } as unknown as EntityManager, query };
}

describe('invoice numbering year (school calendar, Asia/Dhaka)', () => {
  afterEach(() => vi.useRealTimers());

  function freeze(iso: string) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  }

  it('23:59 Dhaka on 31 Dec still uses the old year', async () => {
    freeze('2026-12-31T17:59:00Z');
    const { manager } = fakeManager(871);
    expect(await generateInvoiceNumber(manager, 't1')).toBe('INV-2026-00871');
  });

  it('00:00 Dhaka on 1 Jan starts the new year, even though UTC is still 2026', async () => {
    freeze('2026-12-31T18:00:00Z');
    const { manager, query } = fakeManager(1);
    expect(await generateInvoiceNumber(manager, 't1')).toBe('INV-2027-00001');
    // Lock key and LIKE lookup use the same year as the number.
    expect(query.mock.calls[0][1]).toEqual(['t1:INV-2027-']);
    expect(query.mock.calls[1][1][2]).toBe('INV-2027-%');
  });

  it('05:59 Dhaka on 1 Jan (UTC 23:59 on 31 Dec) is 2027', async () => {
    freeze('2026-12-31T23:59:00Z');
    const { manager } = fakeManager(1);
    expect(await generateInvoiceNumber(manager, 't1')).toBe('INV-2027-00001');
  });

  it('credit notes follow the same rule', async () => {
    freeze('2026-12-31T18:30:00Z');
    const { manager, query } = fakeManager(1);
    expect(await generateCreditNoteNumber(manager, 't1')).toBe('CN-2027-000001');
    expect(query.mock.calls[0][1]).toEqual(['t1:CN-2027-']);
  });
});
