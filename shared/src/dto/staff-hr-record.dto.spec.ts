import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StaffEmploymentStatus } from '../enums/index';
import { StaffDesignationHistoryDto } from './staff-hr-record.dto';

describe('StaffDesignationHistoryDto', () => {
  const valid = {
    user_id: '11111111-1111-4111-8111-111111111111',
    designation_id: '22222222-2222-4222-8222-222222222222',
    effective_date: '2026-01-01',
    status: StaffEmploymentStatus.REGULAR,
  };

  it('accepts a valid payload', async () => {
    const dto = plainToInstance(StaffDesignationHistoryDto, valid);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a payload missing a required field', async () => {
    const { effective_date: _effective_date, ...missingEffectiveDate } = valid;
    const dto = plainToInstance(StaffDesignationHistoryDto, missingEffectiveDate);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'effective_date')).toBe(true);
  });
});
