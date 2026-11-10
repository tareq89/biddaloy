import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { OwnerSeedingService } from './owner-seeding.service';

const build = () => {
  const transaction = vi.fn();
  const ensure = vi.fn();
  const svc = new OwnerSeedingService(
    { transaction } as never,
    { ensure } as never,
    { platformTenantId: vi.fn() } as never,
  );
  return { svc, transaction };
};

describe('OwnerSeedingService (no database)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does nothing in demo mode', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const { svc, transaction } = build();
    await svc.seed({ COCKPIT_OWNER_1_EMAIL: 'a@x.test' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('skips with nothing set outside production', async () => {
    const { svc, transaction } = build();
    await svc.seed({ NODE_ENV: 'development' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('warns once and skips in production with nothing set, without throwing', async () => {
    const { svc, transaction } = build();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(svc.seed({ NODE_ENV: 'production' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled(); // no owners created
    warn.mockRestore();
  });

  it('throws in production when only one slot is set, naming the slot', async () => {
    const { svc } = build();
    await expect(
      svc.seed({
        NODE_ENV: 'production',
        COCKPIT_OWNER_1_EMAIL: 'a@x.test',
        COCKPIT_OWNER_1_PHONE: '01711111111',
      }),
    ).rejects.toThrow('COCKPIT_OWNER_2');
  });

  it('refuses a slot with an email and no phone, naming only the slot', async () => {
    const { svc } = build();
    const err = await svc
      .seed({
        COCKPIT_OWNER_1_EMAIL: 'only@x.test',
        COCKPIT_OWNER_2_EMAIL: 'b@x.test',
        COCKPIT_OWNER_2_PHONE: '01711111111',
      })
      .catch((e: Error) => e);
    expect((err as Error).message).toContain('COCKPIT_OWNER_1');
    expect((err as Error).message).not.toContain('only@x.test');
  });

  it('refuses half a slot without echoing the value', async () => {
    const { svc } = build();
    const err = await svc
      .seed({
        COCKPIT_OWNER_1_EMAIL: 'secret@x.test',
        COCKPIT_OWNER_2_EMAIL: 'b@x.test',
        COCKPIT_OWNER_2_PHONE: '01711111111',
      })
      .catch((e: Error) => e);
    expect((err as Error).message).toContain('COCKPIT_OWNER_1');
    expect((err as Error).message).not.toContain('secret@x.test');
  });
});
