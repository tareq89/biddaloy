import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MONEY_MAX } from '../../../common/constants/money';
import { CreateSmsPackageDto } from './dto/sms-bundle-catalog.dto';

const ok = { name: 'Starter', smsCount: 100, validityDays: 30, priceTaka: 50 };
const bad = async (patch: object) =>
  (await validate(plainToInstance(CreateSmsPackageDto, { ...ok, ...patch }))).length > 0;

describe('CreateSmsPackageDto bounds', () => {
  it('accepts the edges', async () => {
    expect(await bad({})).toBe(false);
    expect(await bad({ smsCount: 1_000_000, validityDays: 365, priceTaka: MONEY_MAX })).toBe(false);
  });
  it('rejects out-of-range values', async () => {
    expect(await bad({ smsCount: 99 })).toBe(true);
    expect(await bad({ smsCount: 1_000_001 })).toBe(true);
    expect(await bad({ validityDays: 0 })).toBe(true);
    expect(await bad({ validityDays: 366 })).toBe(true);
    expect(await bad({ priceTaka: MONEY_MAX + 1 })).toBe(true);
    expect(await bad({ priceTaka: 1.234 })).toBe(true);
    expect(await bad({ priceTaka: -1 })).toBe(true);
    expect(await bad({ name: '   ' })).toBe(true);
  });
});
