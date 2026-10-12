import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PromotionOutcome } from '@biddaloy/shared';
import { PatchPromotionEntryDto } from './promotions.dto';

const STUDENT_ID = '00000000-0000-4000-8000-000000000001';

async function errorsFor(final_outcome: string) {
  const dto = plainToInstance(PatchPromotionEntryDto, { student_id: STUDENT_ID, final_outcome });
  return validate(dto);
}

describe('PatchPromotionEntryDto.final_outcome', () => {
  it('accepts PROMOTE, RETAIN and GRADUATE', async () => {
    expect(await errorsFor(PromotionOutcome.PROMOTE)).toHaveLength(0);
    expect(await errorsFor(PromotionOutcome.RETAIN)).toHaveLength(0);
    expect(await errorsFor(PromotionOutcome.GRADUATE)).toHaveLength(0);
  });

  // [68.1.fix] Commit has no CONDITIONAL branch until #2296, so a CONDITIONAL
  // student would get no next-year enrollment. Refused with a clear message.
  it('refuses CONDITIONAL with a message naming the allowed outcomes', async () => {
    const errors = await errorsFor(PromotionOutcome.CONDITIONAL);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('final_outcome');
    expect(Object.values(errors[0].constraints ?? {})[0]).toBe(
      'final_outcome must be one of: PROMOTE, RETAIN, GRADUATE',
    );
  });
});
