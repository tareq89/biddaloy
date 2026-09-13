import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { QueryFeeStructureDto, toFamilyStudentFee } from './fees.dto';
import { StudentFee } from '../entities/student-fee.entity';
import { FeeStatus, FeeType, PeriodType } from '@biddaloy/shared';

/**
 * [8.14.9] Regression test for a boolean query-param coercion bug: an HTTP
 * query string always arrives as a *string* (`req.query.is_recurring ===
 * 'false'`, never a real `false`), and `@Type(() => Boolean)`'s underlying
 * `Boolean(value)` treats any non-empty string — including the literal text
 * `"false"` — as truthy. `?is_recurring=false` would silently become
 * `is_recurring: true`, returning the opposite of what was asked. The fix
 * (`@Transform` matching the two literal strings a query param can carry)
 * must be exercised via `plainToInstance` with string input, the same shape
 * NestJS's query-param pipe hands the DTO — passing a real JS boolean
 * (as the service-level integration tests do) would never catch this.
 */
describe('QueryFeeStructureDto is_recurring boolean coercion', () => {
  it('parses the query string "false" as boolean false, not true', () => {
    const dto = plainToInstance(QueryFeeStructureDto, { is_recurring: 'false' });
    expect(dto.is_recurring).toBe(false);
  });

  it('parses the query string "true" as boolean true', () => {
    const dto = plainToInstance(QueryFeeStructureDto, { is_recurring: 'true' });
    expect(dto.is_recurring).toBe(true);
  });

  it('leaves is_recurring undefined when absent from the query', () => {
    const dto = plainToInstance(QueryFeeStructureDto, {});
    expect(dto.is_recurring).toBeUndefined();
  });
});

/**
 * `FamilyStudentFeeDto` is an allow-list (16.1.3): a family caller must
 * never see `occurrence`, `approved_by_user_id`, `fee_generation_id`, or
 * `reminder_threshold_date` — internal bill-generation/dunning bookkeeping.
 */
describe('toFamilyStudentFee withholds internal fields', () => {
  it('does not include occurrence, approved_by_user_id, fee_generation_id, or reminder_threshold_date', () => {
    const fee = {
      id: 'fee-1',
      student_id: 'student-1',
      academic_year_id: 'ay-1',
      fee_structure_id: 'fs-1',
      fee_structure: { name: 'Tuition Fee', fee_type: FeeType.MONTHLY_TUITION },
      fee_generation_id: 'gen-1',
      period_start: new Date('2026-03-01'),
      period_type: PeriodType.MONTH,
      occurrence: 2,
      month: 3,
      year: 2026,
      total_amount: 1000,
      paid_amount: 0,
      discount_amount: 0,
      standing_discount_amount: 0,
      one_off_discount_amount: 0,
      status: FeeStatus.PENDING,
      due_date: null,
      reminder_threshold_date: new Date('2026-03-10'),
      approved_by_user_id: 'user-1',
      late_fee_for_student_fee_id: null,
    } as unknown as StudentFee;

    const dto = toFamilyStudentFee(fee);

    expect(dto).not.toHaveProperty('occurrence');
    expect(dto).not.toHaveProperty('approved_by_user_id');
    expect(dto).not.toHaveProperty('fee_generation_id');
    expect(dto).not.toHaveProperty('reminder_threshold_date');
    expect(dto).toEqual({
      id: 'fee-1',
      student_id: 'student-1',
      academic_year_id: 'ay-1',
      fee_name: 'Tuition Fee',
      fee_type: FeeType.MONTHLY_TUITION,
      month: 3,
      year: 2026,
      period_start: fee.period_start,
      period_type: PeriodType.MONTH,
      total_amount: 1000,
      paid_amount: 0,
      discount_amount: 0,
      status: FeeStatus.PENDING,
      due_date: null,
    });
  });
});
