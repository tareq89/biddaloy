import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditAction } from '@biddaloy/shared';
import { PlatformSettingsService, APPROVALS_ENABLED_KEY } from './platform-settings.service';

describe('PlatformSettingsService', () => {
  let repo: any, audit: any, ds: any, svc: PlatformSettingsService;
  beforeEach(() => {
    repo = {
      findOne: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    const m = { query: vi.fn().mockResolvedValue([]), getRepository: () => repo };
    ds = { transaction: vi.fn((fn: any) => fn(m)), m };
    svc = new PlatformSettingsService(repo, audit, ds);
  });

  it('approvals.enabled defaults to true when no row exists (D8)', async () => {
    expect(await svc.get(APPROVALS_ENABLED_KEY)).toBe(true);
  });

  it('returns the stored value, including false', async () => {
    repo.findOne.mockResolvedValue({ key: APPROVALS_ENABLED_KEY, value: false });
    expect(await svc.get(APPROVALS_ENABLED_KEY)).toBe(false);
  });

  it('update takes the advisory lock before reading, then writes and audits', async () => {
    repo.findOne.mockResolvedValue({ key: 'k', value: 1 });
    await svc.update<number>('k', (o) => o + 1, 'u1');
    expect(ds.m.query.mock.invocationCallOrder[0]).toBeLessThan(
      repo.findOne.mock.invocationCallOrder[0],
    );
    expect(ds.m.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(repo.upsert).toHaveBeenCalledWith({ key: 'k', value: 2, updated_by: 'u1' }, ['key']);
    expect(audit.record).toHaveBeenCalled();
  });

  it('set records updated_by and a PLATFORM_SETTINGS_CHANGED audit row', async () => {
    await svc.set(APPROVALS_ENABLED_KEY, false, 'u1');
    expect(repo.upsert).toHaveBeenCalledWith(
      { key: APPROVALS_ENABLED_KEY, value: false, updated_by: 'u1' },
      ['key'],
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PLATFORM_SETTINGS_CHANGED,
        tenant_id: null,
        performed_by_user_id: 'u1',
        old_values: { key: APPROVALS_ENABLED_KEY, value: true },
        new_values: { key: APPROVALS_ENABLED_KEY, value: false },
      }),
    );
  });
});
