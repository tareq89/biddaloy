import { describe, it, expect, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { nextTenantSerial } from './next-serial.util';

describe('nextTenantSerial', () => {
  it('locks on <tenant>:<prefix> and matches only numeric suffixes of the prefix', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ n: '8' }]);
    const n = await nextTenantSerial({ query } as unknown as EntityManager, {
      table: 'invoices',
      column: 'invoice_number',
      tenantId: 't1',
      prefix: 'INV-2026-',
    });
    expect(n).toBe(8);
    expect(query.mock.calls[0][1]).toEqual(['t1:INV-2026-']);
    expect(query.mock.calls[1][0]).toContain('tenant_id = $1');
    expect(query.mock.calls[1][1]).toEqual(['t1', '^INV-2026-[0-9]{1,15}$', 'INV-2026-%']);
  });

  it('bounds the suffix to 15 digits and matches the prefix literally', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ n: '1' }]);
    await nextTenantSerial({ query } as unknown as EntityManager, {
      table: 'invoices',
      column: 'invoice_number',
      tenantId: 't1',
      prefix: 'A.B_',
    });
    const [, pattern, like] = query.mock.calls[1][1];
    const re = new RegExp(pattern);
    // A 15-digit suffix still counts; 16+ digits (e.g. a restored junk number) would overflow
    // the bigint cast or lose precision, so it is ignored like any other junk suffix.
    expect(re.test('A.B_123456789012345')).toBe(true);
    expect(re.test('A.B_9999999999999999999')).toBe(false);
    // `.` is literal, not "any character".
    expect(re.test('AxB_1')).toBe(false);
    expect(like).toBe('A.B\\_%');
  });
});
