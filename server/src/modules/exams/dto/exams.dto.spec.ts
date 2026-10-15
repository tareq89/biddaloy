import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MarkCellDto } from './marks.dto';
import { CreateExamDto, UpdateExamDto } from './exams.dto';
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

describe('mark_entry_deadline', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const base = { name: 'T', kind: 'TERM', academic_year_id: uuid, class_id: uuid };
  const hasErr = async (cls: any, body: object) =>
    (await validate(plainToInstance(cls, body))).some((e) => e.property === 'mark_entry_deadline');

  it('accepts YYYY-MM-DD on create and update', async () => {
    expect(await hasErr(CreateExamDto, { ...base, mark_entry_deadline: '2026-10-11' })).toBe(false);
    expect(await hasErr(UpdateExamDto, { mark_entry_deadline: '2026-10-11' })).toBe(false);
  });

  it('rejects a wrongly formatted or impossible date', async () => {
    for (const bad of ['11/10/2026', '2026-13-01']) {
      expect(await hasErr(CreateExamDto, { ...base, mark_entry_deadline: bad })).toBe(true);
      expect(await hasErr(UpdateExamDto, { mark_entry_deadline: bad })).toBe(true);
    }
  });

  it('accepts null on update only (null clears it); omitted is fine on create', async () => {
    expect(await hasErr(UpdateExamDto, { mark_entry_deadline: null })).toBe(false);
    expect(await hasErr(CreateExamDto, { ...base, mark_entry_deadline: null })).toBe(true);
    expect(await hasErr(CreateExamDto, base)).toBe(false);
  });
});
