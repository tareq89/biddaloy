import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { findDuplicateFlag, normaliseReference } from './reference.util';

describe('normaliseReference', () => {
  it('trims and upper-cases; empty becomes null', () => {
    expect(normaliseReference('  8n7a6d5 ')).toBe('8N7A6D5');
    expect(normaliseReference('   ')).toBeNull();
    expect(normaliseReference(undefined)).toBeNull();
  });
});

describe('findDuplicateFlag', () => {
  const run = (rows: unknown[][]) => {
    const query = vi.fn();
    rows.forEach((r) => query.mockResolvedValueOnce(r));
    return { manager: { query } as unknown as EntityManager, query };
  };

  it('flags a confirmed payment first, compared in normalised form (raw lower-case counter text)', async () => {
    const { manager, query } = run([[{ '?column?': 1 }]]);
    expect(await findDuplicateFlag(manager, 't', 'ABC1', 's')).toBe('DUPLICATE_PAYMENT');
    // The SQL upper-cases and trims the stored raw text before comparing.
    expect(query.mock.calls[0][0]).toContain('UPPER(TRIM(transaction_reference))');
    // A reversed payment (or the reversal row itself) is not a duplicate.
    expect(query.mock.calls[0][0]).toContain('reversed_by_payment_id IS NULL');
    expect(query.mock.calls[0][0]).toContain('reversal_of_payment_id IS NULL');
  });

  it('flags another waiting proof but excludes the same submission', async () => {
    const { manager, query } = run([[], [{ '?column?': 1 }]]);
    expect(await findDuplicateFlag(manager, 't', 'ABC1', 'self')).toBe('DUPLICATE_PENDING');
    expect(query.mock.calls[1][0]).toContain('id <> $3');
    expect(query.mock.calls[1][1]).toEqual(['t', 'ABC1', 'self']);
  });

  it('no reference, no query, no flag', async () => {
    const { manager, query } = run([]);
    expect(await findDuplicateFlag(manager, 't', null, 's')).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
