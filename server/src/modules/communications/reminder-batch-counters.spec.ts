import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordBatchOutcome } from './reminder-batch-counters';

describe('recordBatchOutcome', () => {
  // Standing in for an EntityManager — same `.query(sql, params)` shape as
  // the Repository this used to take, so a caller running this inside a
  // transaction (see communications.processor.ts's settle) just passes the
  // transactional manager through.
  let manager: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    manager = { query: vi.fn(async () => undefined) };
  });

  function paramsOf(call: number) {
    return manager.query.mock.calls[call][1] as [string, number, number];
  }

  it('increments only successful_count for a success', async () => {
    await recordBatchOutcome(manager as any, 'batch-1', 'success');

    expect(paramsOf(0)).toEqual(['batch-1', 1, 0]);
  });

  it('increments only failed_count for a failure', async () => {
    await recordBatchOutcome(manager as any, 'batch-1', 'failure');

    expect(paramsOf(0)).toEqual(['batch-1', 0, 1]);
  });

  it('increments and resolves the final status in one statement', async () => {
    // Two statements would let concurrent workers each see an incomplete
    // batch and leave it stuck in PROCESSING, so this is the property that
    // actually matters — not the SQL text.
    await recordBatchOutcome(manager as any, 'batch-1', 'success');

    expect(manager.query).toHaveBeenCalledTimes(1);
    const sql = manager.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/UPDATE "reminder_batches"/);
    expect(sql).toMatch(/"successful_count" = "successful_count" \+ \$2/);
    expect(sql).toMatch(/"failed_count" = "failed_count" \+ \$3/);
    expect(sql).toMatch(/"status" = CASE/);
  });

  it('closes the batch out on or after the last expected outcome', async () => {
    await recordBatchOutcome(manager as any, 'batch-1', 'failure');

    const sql = manager.query.mock.calls[0][0] as string;
    // `>=` rather than `=` so a replayed job can't leave the batch open.
    expect(sql).toMatch(/>= "total_recipients"/);
    expect(sql).toMatch(/'COMPLETED'/);
    expect(sql).toMatch(/'FAILED'/);
    expect(sql).toMatch(/'PARTIALLY_FAILED'/);
  });

  it('scopes the update to the given batch', async () => {
    await recordBatchOutcome(manager as any, 'batch-9', 'success');

    expect(manager.query.mock.calls[0][0]).toMatch(/WHERE "id" = \$1/);
    expect(paramsOf(0)[0]).toBe('batch-9');
  });
});
