import { describe, it, expect, vi } from 'vitest';
import { AuditAction } from '@biddaloy/shared';
import { SmsSourceService } from './sms-source.service';

function build(settings: Record<string, unknown> | null) {
  const school: any = { id: 's1', settings };
  const save = vi.fn(async (s) => s);
  const qb = {
    where: () => qb,
    setLock: () => qb,
    getOne: async () => school,
  };
  const manager = {
    getRepository: () => ({ createQueryBuilder: () => qb, save }),
  };
  const repo: any = {
    manager: { transaction: (fn: any) => fn(manager) },
    findOne: vi.fn(async () => school),
  };
  const audit = { record: vi.fn() };
  const cache = { invalidate: vi.fn() };
  return {
    svc: new SmsSourceService(repo, audit as any, cache as any),
    save,
    audit,
    cache,
    school,
  };
}

describe('SmsSourceService', () => {
  it('switches, audits old/new only, and drops the cache', async () => {
    const { svc, save, audit, cache, school } = build({
      communications: { sms: { provider: 'mimsms', mimsms: { apiKey: 'enc', senderId: 'S' } } },
    });
    const r = await svc.set('s1', 'SCHOOLMANAGERP', 'u1');
    expect(r).toEqual({ source: 'SCHOOLMANAGERP', ownProviderSaved: true });
    expect(save).toHaveBeenCalledOnce();
    expect(school.settings.communications.sms.metering).toBe('PLATFORM');
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: AuditAction.SMS_SOURCE_CHANGED,
      old_values: { source: 'OWN' },
      new_values: { source: 'SCHOOLMANAGERP' },
    });
    expect(cache.invalidate).toHaveBeenCalledWith('s1');
  });

  it('same value: no write, no audit, no cache drop', async () => {
    const { svc, save, audit, cache } = build({ communications: { sms: { source: 'OWN' } } });
    expect(await svc.set('s1', 'OWN', 'u1')).toEqual({ source: 'OWN', ownProviderSaved: false });
    expect(save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('ownProviderSaved is false for a partial block', async () => {
    const { svc } = build({ communications: { sms: { mimsms: { senderId: 'S' } } } });
    expect((await svc.get('s1')).ownProviderSaved).toBe(false);
  });
});
