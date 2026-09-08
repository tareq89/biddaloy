import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSchoolProfileDto } from './update-school-profile.dto';

/**
 * `name` is the one profile field a school can never unset (`schools.name`
 * is NOT NULL). `@IsOptional()` would let `null` through validation and
 * fail at the database instead, so the DTO must reject `null` as a 400
 * while still treating an *omitted* `name` as "unchanged".
 */
describe('UpdateSchoolProfileDto name', () => {
  it('rejects null', async () => {
    const dto = plainToInstance(UpdateSchoolProfileDto, { name: null });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['name']);
  });

  it('rejects an empty string', async () => {
    const dto = plainToInstance(UpdateSchoolProfileDto, { name: '' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['name']);
  });

  it('accepts an omitted name (partial update leaves it unchanged)', async () => {
    const dto = plainToInstance(UpdateSchoolProfileDto, { address: 'Somewhere' });
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts a non-empty name', async () => {
    const dto = plainToInstance(UpdateSchoolProfileDto, { name: 'Ananta School' });
    expect(await validate(dto)).toEqual([]);
  });

  it('still allows null for the nullable fields', async () => {
    const dto = plainToInstance(UpdateSchoolProfileDto, { name_bn: null, address: null });
    expect(await validate(dto)).toEqual([]);
  });
});
