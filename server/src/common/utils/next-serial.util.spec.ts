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
    expect(query.mock.calls[1][1]).toEqual(['t1', '^INV-2026-[0-9]+$']);
  });
});
