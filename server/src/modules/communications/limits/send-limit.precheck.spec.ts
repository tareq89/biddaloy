import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { CommunicationMedium } from '@biddaloy/shared';
import { assertRoomForBatch } from './send-limit.precheck';

const mk = (source: string, remaining = 300) => {
  const remainingFn = vi.fn(async () => ({ limit: 1000, remaining }));
  const resolveFor = vi.fn(async () => ({ source }));
  return {
    deps: { registry: { resolveFor }, limits: { remaining: remainingFn } } as any,
    remainingFn,
    resolveFor,
  };
};

describe('assertRoomForBatch', () => {
  it('refuses a platform batch bigger than what is left, with the numbers', async () => {
    const { deps } = mk('platform');
    const err: any = await assertRoomForBatch(deps, 't', CommunicationMedium.SMS, 500).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toEqual({
      message: 'Daily limit reached.',
      details: { code: 'DAILY_LIMIT_REACHED', requested: 500, remaining: 300, limit: 1000 },
    });
  });
  it('passes when it fits', async () => {
    const { deps } = mk('platform');
    await expect(
      assertRoomForBatch(deps, 't', CommunicationMedium.SMS, 300),
    ).resolves.toBeUndefined();
  });
  it('skips a tenant-owned gateway without reading the limit', async () => {
    const { deps, remainingFn } = mk('tenant');
    await assertRoomForBatch(deps, 't', CommunicationMedium.SMS, 500);
    expect(remainingFn).not.toHaveBeenCalled();
  });
  it('leaves a resolve error to the existing path', async () => {
    const { deps, resolveFor } = mk('platform');
    resolveFor.mockRejectedValue(new Error('none'));
    await expect(
      assertRoomForBatch(deps, 't', CommunicationMedium.SMS, 500),
    ).resolves.toBeUndefined();
  });
});
