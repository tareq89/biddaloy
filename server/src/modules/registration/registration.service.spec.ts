import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, GoneException, ServiceUnavailableException } from '@nestjs/common';
import { TenantStatusService } from '../schools/tenant-status.service';
import { RegistrationService } from './registration.service';

/** Only the pieces `start` touches; everything else is never reached. */
function build(env: Record<string, string>, deliver: ReturnType<typeof vi.fn>) {
  const config = { get: (k: string) => env[k] };
  const turnstile = { verify: vi.fn(), assertAvailable: vi.fn() };
  const staging = { stage: vi.fn().mockResolvedValue('id-1'), peek: vi.fn() };
  const otp = { request: vi.fn().mockResolvedValue({ code: '123456' }) };
  return new RegistrationService(
    turnstile as never,
    staging as never,
    otp as never,
    { deliver } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    config as never,
    {} as never,
    {} as never,
    // Real service: only its constructor's env read is reached.
    new TenantStatusService({} as never, {} as never, config as never),
  );
}

const dto = {
  admin_name: 'A',
  school_name: 'S',
  country_code: 'BD',
  address: 'x',
  phone: '01711000000',
  email: 'a@example.com',
  terms_accepted: true,
  captcha_token: 't',
} as never;
const ctx = { ip: null, userAgent: null };

describe('RegistrationService.start delivery', () => {
  it('answers 503 in production when the code could not be sent', async () => {
    const deliver = vi.fn().mockResolvedValue({ logId: 'l', status: 'FAILED' });
    const s = build({ NODE_ENV: 'production', PLATFORM_TENANT_ID: 'p' }, deliver);
    await expect(s.start(dto, ctx)).rejects.toThrow(ServiceUnavailableException);
  });

  it('answers 503 in production when there is no platform tenant to send from', async () => {
    const deliver = vi.fn();
    const s = build({ NODE_ENV: 'production' }, deliver);
    await expect(s.start(dto, ctx)).rejects.toThrow(ServiceUnavailableException);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('sends through the platform tenant and answers normally when delivery works', async () => {
    const deliver = vi.fn().mockResolvedValue({ logId: 'l', status: 'SENT' });
    const s = build({ NODE_ENV: 'production', PLATFORM_TENANT_ID: 'p' }, deliver);
    await expect(s.start(dto, ctx)).resolves.toMatchObject({ channel: 'sms', resend_in: 60 });
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'p', kind: 'OTP' }));
  });

  it('sends from the trimmed platform id, not the raw env value', async () => {
    const deliver = vi.fn().mockResolvedValue({ logId: 'l', status: 'SENT' });
    const s = build({ NODE_ENV: 'production', PLATFORM_TENANT_ID: ' P \n' }, deliver);
    await s.start(dto, ctx);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'p' }));
  });

  it('stays quiet outside production when nothing can be sent', async () => {
    const s = build({ NODE_ENV: 'test' }, vi.fn());
    await expect(s.start(dto, ctx)).resolves.toMatchObject({ registration_id: 'id-1' });
  });
});

/** D6 + [68.1.2221] createSchool stores the proven phone and, when free, the typed email (unverified). */
describe('RegistrationService.createSchool contacts', () => {
  const staged = (over: Record<string, unknown> = {}) => ({
    channel: 'sms',
    school_name: 'S',
    admin_name: 'A',
    country_code: 'BD',
    address: 'x',
    phone: '01711000000',
    email: 'a@example.com',
    ...over,
  });

  function run(stage: Record<string, unknown>, findOne: ReturnType<typeof vi.fn>) {
    const provision = vi.fn().mockRejectedValue(new Error('stop'));
    const s = new RegistrationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { provision } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { findOne } as never,
      {} as never,
      {} as never,
    );
    const call = (
      s as never as { createSchool: (...a: unknown[]) => Promise<unknown> }
    ).createSchool('reg-1', stage, ctx, undefined);
    return { provision, call };
  }

  it('passes phone and the typed email to provisioning when nobody holds the email', async () => {
    // First lookup: phone owner (none). Second: email holder, soft-deleted included (none).
    const findOne = vi.fn().mockResolvedValue(null);
    const { provision, call } = run(staged(), findOne);
    await expect(call).rejects.toThrow('stop');
    expect(provision.mock.calls[0][0].admin).toEqual({
      name: 'A',
      phone: '01711000000',
      email: 'a@example.com',
    });
    expect(findOne.mock.calls[1][0]).toMatchObject({ withDeleted: true });
  });

  it('silently omits an email another user row holds (no error, no echo)', async () => {
    const findOne = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'victim' });
    const { provision, call } = run(staged(), findOne);
    await expect(call).rejects.toThrow('stop');
    const admin = provision.mock.calls[0][0].admin;
    expect(admin).toEqual({ name: 'A', phone: '01711000000' });
    expect('email' in admin).toBe(false);
  });

  it('passes only phone when no email was typed', async () => {
    const { provision, call } = run(staged({ email: null }), vi.fn().mockResolvedValue(null));
    await expect(call).rejects.toThrow('stop');
    expect(provision.mock.calls[0][0].admin).toEqual({ name: 'A', phone: '01711000000' });
  });

  it('answers 410 for a stage written before D6 that proved an email', async () => {
    const s = build({}, vi.fn());
    (s as never as { staging: { peek: unknown } }).staging.peek = vi
      .fn()
      .mockResolvedValue(staged({ channel: 'email' }));
    await expect(s.verify({ registration_id: 'r', otp: '123456' } as never, ctx)).rejects.toThrow(
      GoneException,
    );
  });
});

describe('RegistrationService.createSchool created_in_demo flag (Epic 88 D3)', () => {
  async function flagWith(demo: string | undefined) {
    const prev = process.env.DEMO_MODE;
    if (demo === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = demo;
    const update = vi.fn().mockResolvedValue(undefined);
    const provision = vi.fn(async (_d: unknown, _a: unknown, opts: any) => {
      await opts.inTransaction({ update }, { school: { id: 'sch-1' }, admin: { existed: false } });
    });
    const s = new RegistrationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { provision } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { findOne: vi.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
    );
    const stage = {
      channel: 'sms',
      school_name: 'S',
      admin_name: 'A',
      country_code: 'BD',
      address: 'x',
      phone: '01711000000',
      email: null,
    };
    try {
      // The rest of the hook hits unmocked services and throws; the flag write comes first.
      await (s as never as { createSchool: (...a: unknown[]) => Promise<unknown> })
        .createSchool('reg-1', stage, ctx, undefined)
        .catch(() => undefined);
    } finally {
      if (prev === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = prev;
    }
    return update;
  }

  it('sets the flag when DEMO_MODE=true', async () => {
    const update = await flagWith('true');
    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'sch-1' },
      { created_in_demo: true },
    );
  });

  it('leaves it false when DEMO_MODE is unset', async () => {
    const update = await flagWith(undefined);
    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'sch-1' },
      { created_in_demo: false },
    );
  });
});

describe('RegistrationService.start channel', () => {
  it('always uses SMS, even when an email was given', async () => {
    const deliver = vi.fn().mockResolvedValue({ logId: 'l', status: 'SENT' });
    const s = build({ NODE_ENV: 'test', PLATFORM_TENANT_ID: 'p' }, deliver);
    await expect(s.start(dto, ctx)).resolves.toMatchObject({ channel: 'sms' });
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ medium: 'SMS', to: '01711000000' }),
    );
  });

  it('answers 400 for a number outside the allowed prefixes, without echoing it', async () => {
    const s = build({ NODE_ENV: 'test' }, vi.fn());
    const err = await s
      .start({ ...(dto as object), phone: '+14155550123' } as never, ctx)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({
      message: ['Invalid phone format'],
      details: { code: 'PHONE_NOT_SUPPORTED' },
    });
  });
});
