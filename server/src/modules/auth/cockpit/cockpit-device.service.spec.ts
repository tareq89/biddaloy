import { describe, it, expect, vi } from 'vitest';
import { CockpitDeviceService } from './cockpit-device.service';
import { hashSecret } from '../token-hash.util';

describe('CockpitDeviceService', () => {
  it('remember stores only the hash of a random 256-bit secret and returns the secret', async () => {
    const insert = vi.fn();
    const svc = new CockpitDeviceService({ insert } as any);
    const secret = await svc.remember('u1', 'Chrome on Mac');
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const row = insert.mock.calls[0][0];
    expect(row).toEqual({ user_id: 'u1', device_hash: hashSecret(secret), label: 'Chrome on Mac' });
    expect(JSON.stringify(row)).not.toContain(secret);
  });

  it('remember truncates a long user agent to the 120-char column', async () => {
    const insert = vi.fn();
    await new CockpitDeviceService({ insert } as any).remember('u1', 'x'.repeat(500));
    expect(insert.mock.calls[0][0].label).toHaveLength(120);
  });

  it('isKnown matches by user and hash, and is false without a cookie', async () => {
    const update = vi.fn().mockResolvedValue({ affected: 1 });
    const svc = new CockpitDeviceService({ update } as any);
    expect(await svc.isKnown('u1', undefined)).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(await svc.isKnown('u1', 'cookie')).toBe(true);
    expect(update.mock.calls[0][0]).toEqual({ user_id: 'u1', device_hash: hashSecret('cookie') });
  });

  it('isKnown is false when no row matches (another user, or forgotten device)', async () => {
    const svc = new CockpitDeviceService({
      update: vi.fn().mockResolvedValue({ affected: 0 }),
    } as any);
    expect(await svc.isKnown('u1', 'cookie')).toBe(false);
  });
});
