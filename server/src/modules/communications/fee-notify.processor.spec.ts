import { describe, it, expect, vi } from 'vitest';
import { FeeNotifyProcessor } from './fee-notify.processor';
import { enqueueFeeNotify } from './communications.constants';

function make() {
  const fees = { handleFeesGenerated: vi.fn().mockResolvedValue(undefined) };
  const invoices = { handlePaymentRecorded: vi.fn().mockResolvedValue(undefined) };
  return { fees, invoices, processor: new FeeNotifyProcessor(fees as any, invoices as any) };
}

describe('FeeNotifyProcessor', () => {
  it('routes fees.generated to the fee handler', async () => {
    const { processor, fees, invoices } = make();
    await processor.process({ name: 'fees.generated', data: { a: 1 } } as any);
    expect(fees.handleFeesGenerated).toHaveBeenCalledWith({ a: 1 });
    expect(invoices.handlePaymentRecorded).not.toHaveBeenCalled();
  });

  it('routes payments.recorded to the receipt handler', async () => {
    const { processor, fees, invoices } = make();
    await processor.process({ name: 'payments.recorded', data: { b: 2 } } as any);
    expect(invoices.handlePaymentRecorded).toHaveBeenCalledWith({ b: 2 });
    expect(fees.handleFeesGenerated).not.toHaveBeenCalled();
  });

  it('rethrows a handler error so BullMQ retries', async () => {
    const { processor, fees } = make();
    fees.handleFeesGenerated.mockRejectedValue(new Error('boom'));
    await expect(processor.process({ name: 'fees.generated', data: {} } as any)).rejects.toThrow(
      'boom',
    );
  });

  it('rejects an unknown job name', async () => {
    const { processor } = make();
    await expect(processor.process({ name: 'nope', data: {} } as any)).rejects.toThrow(/Unknown/);
  });
});

describe('enqueueFeeNotify', () => {
  it('uses a BullMQ-legal jobId (a two-part colon id throws)', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    await enqueueFeeNotify({ add }, { error: vi.fn() }, 'fees.generated', 'g1', { x: 1 });
    expect(add).toHaveBeenCalledWith('fees.generated', { x: 1 }, { jobId: 'fees.generated-g1' });
  });

  // BullMQ ignores `add` while a job with that id is stored, failed ones too.
  // A notice that used up its retries must not block a later replay.
  it('drops a stored FAILED job with the same id before adding again', async () => {
    const calls: string[] = [];
    const stale = {
      isFailed: vi.fn().mockResolvedValue(true),
      remove: vi.fn(async () => void calls.push('remove')),
    };
    const add = vi.fn(async () => void calls.push('add'));
    const getJob = vi.fn().mockResolvedValue(stale);
    await enqueueFeeNotify({ add, getJob }, { error: vi.fn() }, 'payments.recorded', 'p1', {});
    expect(getJob).toHaveBeenCalledWith('payments.recorded-p1');
    expect(calls).toEqual(['remove', 'add']);
  });

  it('leaves a waiting or active job with the same id alone (the replay is a no-op)', async () => {
    const stale = { isFailed: vi.fn().mockResolvedValue(false), remove: vi.fn() };
    const add = vi.fn().mockResolvedValue(undefined);
    await enqueueFeeNotify(
      { add, getJob: vi.fn().mockResolvedValue(stale) },
      { error: vi.fn() },
      'payments.recorded',
      'p1',
      {},
    );
    expect(stale.remove).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('logs and swallows a Redis failure (committed money must not fail)', async () => {
    const error = vi.fn();
    const add = vi.fn().mockRejectedValue(new Error('redis down'));
    await expect(
      enqueueFeeNotify({ add }, { error }, 'payments.recorded', 'p1', {}),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
