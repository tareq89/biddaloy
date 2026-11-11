import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlatformCutoverService } from './platform-cutover.service';

const build = (rows: unknown[][]) => {
  const query = vi.fn();
  for (const r of rows) query.mockResolvedValueOnce(r);
  const transaction = vi.fn();
  const ds = { query, transaction, manager: { query } };
  const svc = new PlatformCutoverService(
    ds as never,
    { platformTenantId: vi.fn() } as never,
    { cutOff: vi.fn() } as never,
    { record: vi.fn() } as never,
  );
  return { svc, transaction };
};

describe('PlatformCutoverService (no database)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does nothing in demo mode', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const { svc, transaction } = build([]);
    expect(await svc.run()).toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does nothing once cutover.done is set', async () => {
    const { svc, transaction } = build([[{ '?column?': 1 }]]);
    expect(await svc.run()).toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('skips on a database with no owners yet (retries next boot)', async () => {
    const { svc, transaction } = build([[], [{ n: 0 }]]);
    expect(await svc.run()).toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });
});
