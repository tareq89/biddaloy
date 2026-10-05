import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { TurnstileService } from './turnstile.service';

function service(env: Record<string, string | undefined>) {
  return new TurnstileService({ get: (k: string) => env[k] } as never);
}

afterEach(() => vi.unstubAllGlobals());

describe('TurnstileService', () => {
  it('closes every route in production when no secret is configured', async () => {
    const s = service({ NODE_ENV: 'production' });
    expect(() => s.assertAvailable()).toThrow(ServiceUnavailableException);
    await expect(s.verify('t', null)).rejects.toMatchObject({
      response: { details: { code: 'REGISTRATION_UNAVAILABLE' } },
    });
  });

  it('skips the check outside production when no secret is configured', async () => {
    await expect(service({ NODE_ENV: 'test' }).verify('t', null)).resolves.toBeUndefined();
  });

  it('rejects a token Cloudflare says is bad', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ success: false }) }));
    await expect(service({ TURNSTILE_SECRET_KEY: 's' }).verify('bad', '1.2.3.4')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts a token Cloudflare says is good', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }));
    await expect(
      service({ TURNSTILE_SECRET_KEY: 's' }).verify('good', null),
    ).resolves.toBeUndefined();
  });

  it('answers 503 (not a pass) when Cloudflare cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(service({ TURNSTILE_SECRET_KEY: 's' }).verify('t', null)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
