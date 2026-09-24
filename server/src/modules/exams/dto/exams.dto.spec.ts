import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MarkCellDto } from './marks.dto';
import { MarkStatus } from '@biddaloy/shared';

describe('IsNonNegativeMarksStringConstraint', () => {
  it('names the actual validated property, not a hardcoded "pass_marks"', async () => {
    const dto = plainToInstance(MarkCellDto, {
      student_id: 'stu-1',
      component_id: 'comp-1',
      value: '-1',
      status: MarkStatus.PRESENT,
    });

    const errors = await validate(dto);
    const valueError = errors.find((e) => e.property === 'value');

    expect(valueError).toBeDefined();
    const message = Object.values(valueError!.constraints ?? {})[0];
    expect(message).toContain('value must be between 0 and');
    expect(message).not.toContain('pass_marks');
  });
});
