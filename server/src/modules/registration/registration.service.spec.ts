import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { RegistrationService } from './registration.service';

/** Only the pieces `start` touches; everything else is never reached. */
function build(env: Record<string, string>, deliver: ReturnType<typeof vi.fn>) {
  const config = { get: (k: string) => env[k] };
  const turnstile = { verify: vi.fn() };
  const staging = { stage: vi.fn().mockResolvedValue('id-1') };
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

  it('stays quiet outside production when nothing can be sent', async () => {
    const s = build({ NODE_ENV: 'test' }, vi.fn());
    await expect(s.start(dto, ctx)).resolves.toMatchObject({ registration_id: 'id-1' });
  });
});
