import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ResetPasswordDto } from './reset-password.dto';

describe('ResetPasswordDto / HasOtpOrTokenConstraint', () => {
  it('does not throw when phone/otp/token are non-string values', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      new_password: 'a-valid-password',
      phone: { not: 'a string' },
      otp: 123456,
      token: ['not', 'a', 'string'],
    });

    await expect(validate(dto)).resolves.not.toThrow();
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a valid { phone, otp } pair', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      new_password: 'a-valid-password',
      phone: '01712345678',
      otp: '123456',
    });

    const errors = await validate(dto);
    expect(errors.find((e) => e.constraints?.hasOtpOrToken)).toBeUndefined();
  });
});
