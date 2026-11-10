import { describe, it, expect, vi, afterEach } from 'vitest';
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

  it('refuses to boot in production with nothing set, naming only the slot', async () => {
    const { svc } = build();
    await expect(svc.seed({ NODE_ENV: 'production' })).rejects.toThrow('COCKPIT_OWNER_1');
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
