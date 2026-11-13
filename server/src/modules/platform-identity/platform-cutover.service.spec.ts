import { describe, it, expect, vi, afterEach } from 'vitest';
import { CutoverRefusedError, PlatformCutoverService } from './platform-cutover.service';

const build = (rows: unknown[][]) => {
  const query = vi.fn();
  for (const r of rows) query.mockResolvedValueOnce(r);
  const transaction = vi.fn();
  const ds = { query, transaction, manager: { query } };
  const svc = new PlatformCutoverService(
    ds as never,
    { platformSchoolIds: vi.fn().mockResolvedValue([]) } as never,
    { cutOff: vi.fn() } as never,
    { record: vi.fn() } as never,
  );
  return { svc, transaction };
};

describe('PlatformCutoverService (no database)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refuses in demo mode', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const { svc, transaction } = build([]);
    await expect(svc.run()).rejects.toBeInstanceOf(CutoverRefusedError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does nothing once cutover.done is set', async () => {
    const { svc, transaction } = build([[{ '?column?': 1 }]]);
    expect((await svc.run()).status).toBe('already_done');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses without a verified owner', async () => {
    // done? no; verified owner? none
    const { svc, transaction } = build([[], []]);
    await expect(svc.run()).rejects.toBeInstanceOf(CutoverRefusedError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses without writing anything when no platform school resolves', async () => {
    // done? no; verified owner? yes; platformSchoolIds() => []
    const { svc, transaction } = build([[], [{ '?column?': 1 }]]);
    await expect(svc.run()).rejects.toBeInstanceOf(CutoverRefusedError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not run itself: there is no boot hook', () => {
    const { svc } = build([]);
    expect((svc as unknown as { onApplicationBootstrap?: unknown }).onApplicationBootstrap).toBe(
      undefined,
    );
  });
});
