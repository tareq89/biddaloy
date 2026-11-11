import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { CockpitEnrolController } from './cockpit-enrol.controller';
import { CockpitEnrolConfirmDto, CockpitEnrolStartDto } from './dto/cockpit-enrol.dto';

const req: any = { ip: '1.1.1.1', headers: { 'user-agent': 'ua' }, cookies: {} };
const res = () => ({ cookie: vi.fn(), setHeader: vi.fn() }) as any;

describe('CockpitEnrolController', () => {
  it('is mounted at auth/cockpit; both routes answer 200 behind the same-origin guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CockpitEnrolController)).toBe('auth/cockpit');
    for (const name of ['start', 'confirm'] as const) {
      const handler = CockpitEnrolController.prototype[name];
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeDefined();
    }
  });

  it('start is not cacheable and returns the secret', async () => {
    const enrol: any = { start: vi.fn().mockResolvedValue({ otpauthUri: 'u', secret: 's' }) };
    const r = res();
    expect(await new CockpitEnrolController(enrol).start({} as any, r)).toEqual({
      otpauthUri: 'u',
      secret: 's',
    });
    expect(r.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('confirm sets the refresh cookie (and the device cookie when issued) and returns the codes', async () => {
    const enrol: any = {
      confirm: vi.fn().mockResolvedValue({
        recoveryCodes: ['a'],
        session: {
          step: 'done',
          accessToken: 'at',
          refreshCookieValue: 'rc',
          deviceCookieValue: 'd',
        },
      }),
    };
    const r = res();
    const out = await new CockpitEnrolController(enrol).confirm({} as any, req, r);
    expect(out).toEqual({ step: 'done', access_token: 'at', recoveryCodes: ['a'] });
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

    it('start needs the token and both codes', async () => {
      expect(
        await run(CockpitEnrolStartDto, { enrolToken: 't', smsCode: '1', emailCode: '2' }),
      ).toBe('ok');
      expect(await run(CockpitEnrolStartDto, { enrolToken: 't', smsCode: '1' })).toBe('bad');
    });

    it('confirm needs the token and one code', async () => {
      expect(await run(CockpitEnrolConfirmDto, { enrolToken: 't', code: '1' })).toBe('ok');
      expect(await run(CockpitEnrolConfirmDto, { code: '1' })).toBe('bad');
    });
  });
});
