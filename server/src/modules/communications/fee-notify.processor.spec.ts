import { describe, it, expect, vi } from 'vitest';
import { FeeNotifyProcessor } from './fee-notify.processor';
import { enqueueFeeNotify } from './communications.constants';

const on = { platform: {}, school: {} };

function make(state: unknown = on) {
  const fees = { handleFeesGenerated: vi.fn().mockResolvedValue(undefined) };
  const invoices = { handlePaymentRecorded: vi.fn().mockResolvedValue(undefined) };
  const reader = { forTenant: vi.fn().mockResolvedValue(state) };
  return {
    fees,
    invoices,
    reader,
    processor: new FeeNotifyProcessor(fees as any, invoices as any, reader as any),
  };
}

describe('FeeNotifyProcessor', () => {
  it('routes fees.generated to the fee handler', async () => {
    const { processor, fees, invoices } = make();
    await processor.process({ name: 'fees.generated', data: { a: 1, tenantId: 'A' } } as any);
    expect(fees.handleFeesGenerated).toHaveBeenCalledWith({ a: 1, tenantId: 'A' });
    expect(invoices.handlePaymentRecorded).not.toHaveBeenCalled();
  });

  it('routes payments.recorded to the receipt handler', async () => {
    const { processor, fees, invoices } = make();
    await processor.process({ name: 'payments.recorded', data: { b: 2, tenant_id: 'A' } } as any);
    expect(invoices.handlePaymentRecorded).toHaveBeenCalledWith({ b: 2, tenant_id: 'A' });
    expect(fees.handleFeesGenerated).not.toHaveBeenCalled();
  });

  it('rethrows a handler error so BullMQ retries', async () => {
    const { processor, fees } = make();
    fees.handleFeesGenerated.mockRejectedValue(new Error('boom'));
    await expect(
      processor.process({ name: 'fees.generated', data: { tenantId: 'A' } } as any),
    ).rejects.toThrow('boom');
  });

  // Money: fees off for the school -> no new automatic notice, either event.
  it('skips both events for a school with fees off', async () => {
    const off = { platform: {}, school: { fees: { on: false } } };
    const { processor, fees, invoices } = make(off);
    await processor.process({ name: 'fees.generated', data: { tenantId: 'A' } } as any);
    await processor.process({ name: 'payments.recorded', data: { tenant_id: 'A' } } as any);
    expect(fees.handleFeesGenerated).not.toHaveBeenCalled();
    expect(invoices.handlePaymentRecorded).not.toHaveBeenCalled();
  });

  it('keeps processing for a school with fees on while another is off', async () => {
    const { processor, fees, reader } = make();
    reader.forTenant.mockImplementation(async (id: string) =>
      id === 'A' ? { platform: {}, school: { fees: { on: false } } } : on,
    );
    await processor.process({ name: 'fees.generated', data: { tenantId: 'A' } } as any);
    await processor.process({ name: 'fees.generated', data: { tenantId: 'B' } } as any);
    expect(fees.handleFeesGenerated).toHaveBeenCalledTimes(1);
    expect(fees.handleFeesGenerated).toHaveBeenCalledWith({ tenantId: 'B' });
  });

  it('rethrows a module read failure so BullMQ retries (never silently drops)', async () => {
    const { processor, fees, reader } = make();
    reader.forTenant.mockRejectedValue(new Error('db down'));
    await expect(
      processor.process({ name: 'fees.generated', data: { tenantId: 'A' } } as any),
    ).rejects.toThrow('db down');
    expect(fees.handleFeesGenerated).not.toHaveBeenCalled();
  });

  it('rejects an unknown job name', async () => {
    const { processor } = make();
    await expect(processor.process({ name: 'nope', data: {} } as any)).rejects.toThrow(/Unknown/);
  });

  it('fails a job that carries no tenant id instead of running it ungated', async () => {
    const { processor, fees } = make();
    await expect(processor.process({ name: 'fees.generated', data: {} } as any)).rejects.toThrow(
      /no tenant id/,
    );
    expect(fees.handleFeesGenerated).not.toHaveBeenCalled();
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
