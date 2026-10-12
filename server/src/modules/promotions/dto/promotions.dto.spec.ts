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
  it('accepts PROMOTE, RETAIN, GRADUATE and CONDITIONAL', async () => {
    expect(await errorsFor(PromotionOutcome.PROMOTE)).toHaveLength(0);
    expect(await errorsFor(PromotionOutcome.RETAIN)).toHaveLength(0);
    expect(await errorsFor(PromotionOutcome.GRADUATE)).toHaveLength(0);
    expect(await errorsFor(PromotionOutcome.CONDITIONAL)).toHaveLength(0);
  });

  it('refuses an unknown outcome with a message naming the allowed outcomes', async () => {
    const errors = await errorsFor('BOGUS' as PromotionOutcome);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('final_outcome');
    expect(Object.values(errors[0].constraints ?? {})[0]).toBe(
      'final_outcome must be one of: PROMOTE, RETAIN, GRADUATE, CONDITIONAL',
    );
  });
});
