import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { CockpitPasswordController } from './cockpit-password.controller';
import { CockpitForgotPasswordDto, CockpitResetPasswordDto } from './dto/cockpit-password.dto';

describe('CockpitPasswordController', () => {
  it('forgot answers 202, reset answers 204, both behind the same-origin guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CockpitPasswordController)).toBe('auth/cockpit');
    const proto = CockpitPasswordController.prototype;
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.forgot)).toBe(202);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.reset)).toBe(204);
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.forgot)).toBeDefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.reset)).toBeDefined();
  });

  it('forgot returns nothing; reset passes the request context and sets no cookie', async () => {
    const passwords: any = { forgot: vi.fn(), reset: vi.fn() };
    const controller = new CockpitPasswordController(passwords);
    expect(await controller.forgot({ identifier: 'a@b.com' })).toBeUndefined();
    const req: any = { ip: '1.1.1.1', headers: { 'user-agent': 'ua' } };
    await controller.reset({ token: 't', newPassword: 'x' }, req);
    expect(passwords.reset).toHaveBeenCalledWith(
      { token: 't', newPassword: 'x' },
      { ip: '1.1.1.1', userAgent: 'ua' },
    );
  });

  describe('DTO validation', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true });
    const run = (type: any, value: object) =>
      pipe.transform(value, { type: 'body', metatype: type }).then(
        () => 'ok',
        () => 'bad',
      );

    it('forgot needs an identifier and caps its length', async () => {
      expect(await run(CockpitForgotPasswordDto, { identifier: 'a@b.com' })).toBe('ok');
      expect(await run(CockpitForgotPasswordDto, {})).toBe('bad');
      expect(await run(CockpitForgotPasswordDto, { identifier: 'x'.repeat(101) })).toBe('bad');
    });

    it('reset needs a token and a long enough password', async () => {
      expect(await run(CockpitResetPasswordDto, { token: 't', newPassword: 'x'.repeat(12) })).toBe(
        'ok',
      );
      expect(await run(CockpitResetPasswordDto, { token: 't', newPassword: 'x' })).toBe('bad');
      expect(await run(CockpitResetPasswordDto, { newPassword: 'x'.repeat(12) })).toBe('bad');
    });
  });
});
