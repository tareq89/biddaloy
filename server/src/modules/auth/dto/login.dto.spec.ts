import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

describe('LoginDto', () => {
  it('passes with only email', async () => {
    const dto = plainToInstance(LoginDto, { email: 'admin@test.com', password: 'password123' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('passes with only phone', async () => {
    const dto = plainToInstance(LoginDto, { phone: '+8801700000000', password: 'password123' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('fails when neither email nor phone is provided', async () => {
    const dto = plainToInstance(LoginDto, { password: 'password123' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    const messages = errors.flatMap((err) => Object.values(err.constraints ?? {}));
    expect(messages).toContain('Either email or phone is required');
  });

  it('fails when password is missing', async () => {
    const dto = plainToInstance(LoginDto, { email: 'admin@test.com' });
    const errors = await validate(dto);

    expect(errors.some((err) => err.property === 'password')).toBe(true);
  });
});
