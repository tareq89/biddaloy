import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { FinalResultStatus } from '@biddaloy/shared';
import { finalSourceUnpublished } from '../../common/filters/known-errors';
import { FinalResultsService } from '../final-results/final-results.service';
import { ExamResultRecomputer } from './result-recomputer.service';

describe('ExamResultRecomputer: a PROCESSED final that cannot be rebuilt (#3461)', () => {
  it('names the final result instead of the generic unpublished-source 409', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'f1', name: 'Six', status: FinalResultStatus.PROCESSED }])
      .mockResolvedValueOnce([{ id: 'f1', status: FinalResultStatus.PROCESSED }])
      .mockResolvedValueOnce([]);
    const finals = {
      recompute: vi.fn().mockRejectedValue(finalSourceUnpublished()),
    };
    const recomputer = new ExamResultRecomputer(
      {} as never,
      {} as never,
      { get: (t: unknown) => (t === FinalResultsService ? finals : null) } as never,
    );

    const err = await recomputer.recompute('t1', 's1', { query } as never).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      details: { code: 'SCALE_FINAL_SOURCE_UNPUBLISHED', finals: [{ id: 'f1', name: 'Six' }] },
    });
  });
});
