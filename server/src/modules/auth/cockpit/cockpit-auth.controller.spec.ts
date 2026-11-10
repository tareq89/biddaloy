import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { CockpitAuthController } from './cockpit-auth.controller';
import { CockpitDeviceOtpDto } from './dto/cockpit-device-otp.dto';
import { CockpitLoginDto } from './dto/cockpit-login.dto';
import { CockpitMfaDto } from './dto/cockpit-mfa.dto';
import { COCKPIT_DEVICE_COOKIE } from './cockpit-token-cookie';

const req: any = {
  ip: '1.1.1.1',
  headers: { 'user-agent': 'ua' },
  cookies: { [COCKPIT_DEVICE_COOKIE]: 'dev' },
};
const res = () => ({ cookie: vi.fn(), setHeader: vi.fn() }) as any;

describe('CockpitAuthController', () => {
  let auth: any;
  let controller: CockpitAuthController;
  beforeEach(() => {
    auth = { login: vi.fn(), mfaStep: vi.fn(), deviceOtp: vi.fn() };
    controller = new CockpitAuthController(auth);
  });

  it('is mounted at auth/cockpit and every route answers 200 with a same-origin guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CockpitAuthController)).toBe('auth/cockpit');
    for (const name of ['login', 'mfa', 'deviceOtp'] as const) {
      const handler = CockpitAuthController.prototype[name];
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeDefined();
    }
  });

  it('step results become step bodies and set no cookie', async () => {
    const r = res();
    auth.login.mockResolvedValue({ step: 'mfa', mfaToken: 'm' });
    expect(await controller.login({} as any, req, r)).toEqual({ step: 'mfa', mfaToken: 'm' });
    auth.login.mockResolvedValue({ step: 'enrol', enrolToken: 'e' });
    expect(await controller.login({} as any, req, r)).toEqual({ step: 'enrol', enrolToken: 'e' });
    expect(r.cookie).not.toHaveBeenCalled();
  });

  it('mfa passes the device cookie through; a known device finishes with the refresh cookie', async () => {
    const r = res();
    auth.mfaStep.mockResolvedValue({ step: 'done', accessToken: 'a', refreshCookieValue: 'rc' });
    expect(await controller.mfa({ mfaToken: 't', code: 'c' }, req, r)).toEqual({
      step: 'done',
      access_token: 'a',
    });
    expect(auth.mfaStep.mock.calls[0][2]).toBe('dev');
    expect(r.cookie).toHaveBeenCalledTimes(1);
  });

  it('device-otp sets the device cookie only when one is issued', async () => {
    const r = res();
    auth.deviceOtp.mockResolvedValue({
      step: 'done',
      accessToken: 'a',
      refreshCookieValue: 'rc',
      deviceCookieValue: 'd',
    });
    await controller.deviceOtp({} as any, req, r);
    expect(r.cookie.mock.calls.map((c: any) => c[0])).toEqual([
      '__Host-cockpit_refresh',
      '__Host-cockpit_device',
    ]);
  });

  describe('DTO validation', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true });
    const run = (type: any, value: object) =>
      pipe.transform(value, { type: 'body', metatype: type }).then(
        () => 'ok',
        () => 'bad',
      );

    it('login needs an email or phone and a password', async () => {
      expect(await run(CockpitLoginDto, { email: 'a@b.com', password: 'x' })).toBe('ok');
      expect(await run(CockpitLoginDto, { password: 'x' })).toBe('bad');
      expect(await run(CockpitLoginDto, { email: 'a@b.com' })).toBe('bad');
    });

    it('mfa needs a token and a code, nothing else', async () => {
      expect(await run(CockpitMfaDto, { mfaToken: 't', code: '123456' })).toBe('ok');
      expect(await run(CockpitMfaDto, { mfaToken: 't' })).toBe('bad');
      expect(await run(CockpitMfaDto, { mfaToken: 't', code: '1', userId: 'x' })).toBe('bad');
    });

    it('device-otp needs both codes', async () => {
      expect(
        await run(CockpitDeviceOtpDto, {
          deviceToken: 't',
          smsCode: '1',
          emailCode: '2',
          rememberDevice: true,
        }),
      ).toBe('ok');
      expect(await run(CockpitDeviceOtpDto, { deviceToken: 't', smsCode: '1' })).toBe('bad');
    });
  });
});
