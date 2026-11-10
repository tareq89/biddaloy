import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditAction } from '@biddaloy/shared';
import { PlatformSettingsService, APPROVALS_ENABLED_KEY } from './platform-settings.service';

describe('PlatformSettingsService', () => {
  let repo: any, audit: any, svc: PlatformSettingsService;
  beforeEach(() => {
    repo = {
      findOne: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    svc = new PlatformSettingsService(repo, audit);
  });

  it('approvals.enabled defaults to true when no row exists (D8)', async () => {
    expect(await svc.get(APPROVALS_ENABLED_KEY)).toBe(true);
  });

  it('returns the stored value, including false', async () => {
    repo.findOne.mockResolvedValue({ key: APPROVALS_ENABLED_KEY, value: false });
    expect(await svc.get(APPROVALS_ENABLED_KEY)).toBe(false);
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
