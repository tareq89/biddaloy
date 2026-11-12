import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AuditAction, SupportAccessMode } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AuditService } from '../../audit/audit.service';
import { TenantSettingsCache } from '../../schools/settings/tenant-settings-cache.service';
import { ImpersonationSessionService } from '../sessions/impersonation-session.service';
import { SupportAccessNoticeService } from '../notices/support-access-notice.service';
import { SupportAccessSettingsService } from './support-access-settings.service';

describe('SupportAccessSettingsService (integration)', () => {
  let ds: DataSource;
  let svc: SupportAccessSettingsService;
  const revokeAllForSchool = vi.fn().mockResolvedValue(0);
  const modeChanged = vi.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      SupportAccessSettingsService,
      AuditService,
      { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
      { provide: ImpersonationSessionService, useValue: { revokeAllForSchool } },
      { provide: SupportAccessNoticeService, useValue: { modeChanged } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    svc = module.get(SupportAccessSettingsService);
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const makeSchool = async (settings: Record<string, unknown>) => {
    const id = randomUUID();
    await ds.getRepository(School).save({
      id,
      tenant_id: id,
      name: `SA ${id.slice(0, 6)}`,
      slug: `sa-${id.slice(0, 8)}`,
      settings,
    });
    const uid = randomUUID();
    await ds.getRepository(User).save({
      id: uid,
      email: `a-${uid}@sa.test`,
      phone: null,
      password_hash: 'x',
      full_name: 'Admin',
    });
    return { id, uid };
  };
  const auditRows = (schoolId: string) =>
    ds.getRepository(AuditLog).find({
      where: { tenant_id: schoolId, action: AuditAction.SUPPORT_ACCESS_MODE_CHANGED },
    });

  it('audit row carries old/new and tenant_id; other settings keys survive', async () => {
    const { id, uid } = await makeSchool({ region: { locale: 'en-BD' } });
    await svc.changeMode(id, uid, SupportAccessMode.BLOCKED);
    const rows = await auditRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].old_values).toEqual({ mode: 'allowed' });
    expect(rows[0].new_values).toEqual({ mode: 'blocked' });
    expect(rows[0].tenant_id).toBe(id);
    const school = await ds.getRepository(School).findOneByOrFail({ id });
    expect(school.settings).toMatchObject({
      region: { locale: 'en-BD' },
      supportAccess: { mode: 'blocked' },
    });
  });

  it('a rolled-back transaction leaves no audit row and no settings change', async () => {
    const { id, uid } = await makeSchool({});
    vi.spyOn(AuditService.prototype, 'record').mockRejectedValueOnce(new Error('boom'));
    await expect(svc.changeMode(id, uid, SupportAccessMode.ASK)).rejects.toThrow('boom');
    expect(await auditRows(id)).toHaveLength(0);
    const school = await ds.getRepository(School).findOneByOrFail({ id });
    expect(school.settings).toEqual({});
  });

  it('changing school A never touches school B', async () => {
    const a = await makeSchool({});
    const b = await makeSchool({});
    await svc.changeMode(a.id, a.uid, SupportAccessMode.BLOCKED);
    expect((await svc.get(b.id)).mode).toBe('allowed');
    expect(await auditRows(b.id)).toHaveLength(0);
    expect(revokeAllForSchool).toHaveBeenLastCalledWith(a.id, 'MODE_BLOCKED');
  });
});
