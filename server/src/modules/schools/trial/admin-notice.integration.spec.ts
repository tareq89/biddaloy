import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { UserRole, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { CommunicationProviderRegistryService } from '../../communications/providers/communication-provider.registry';
import { AdminNoticeService } from './admin-notice.service';
import { renderNotice } from './admin-notice-templates';

describe('AdminNoticeService (integration)', () => {
  let ds: DataSource;
  let svc: AdminNoticeService;
  const send = vi.fn().mockResolvedValue({
    success: true,
    providerMessageId: 'pm-1',
    provider: 'smtp',
    source: 'platform',
  });
  const registry = { resolve: () => ({ send }) };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      AdminNoticeService,
      { provide: CommunicationProviderRegistryService, useValue: registry },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    svc = module.get(AdminNoticeService);
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const school = async (locale?: string): Promise<string> => {
    const id = randomUUID();
    await ds.getRepository(School).save({
      id,
      tenant_id: id,
      name: `Notice ${id.slice(0, 6)}`,
      slug: `notice-${id.slice(0, 8)}`,
      settings: locale ? { region: { locale } } : null,
    });
    return id;
  };
  const member = async (
    tenantId: string,
    role: UserRole,
    status: UserStatus,
    tag: string,
  ): Promise<string> => {
    const uid = randomUUID();
    await ds.getRepository(User).save({
      id: uid,
      email: `${tag}-${uid}@notice.test`,
      phone: null,
      password_hash: 'x',
      full_name: tag,
      status,
    });
    await ds.getRepository(UserTenant).save({ user_id: uid, tenant_id: tenantId, role });
    return `${tag}-${uid}@notice.test`;
  };

  it('emails only ACTIVE ADMINs of that school, in bn for a bn school, and logs each send', async () => {
    send.mockClear();
    const a = await school('bn');
    const b = await school();
    const admin = await member(a, UserRole.ADMIN, UserStatus.ACTIVE, 'admin');
    await member(a, UserRole.ADMIN, UserStatus.INACTIVE, 'inactive-admin');
    await member(a, UserRole.TEACHER, UserStatus.ACTIVE, 'teacher');
    await member(b, UserRole.ADMIN, UserStatus.ACTIVE, 'other-tenant-admin');

    await svc.notifyAdmins(a, 'welcome');

    expect(send).toHaveBeenCalledTimes(1);
    const [params, tenantId] = send.mock.calls[0];
    expect(params.to).toBe(admin);
    expect(tenantId).toBe(a);
    // The notice is the platform talking to the school's admins, so it may use the platform SMS
    // keys even when the school has no gateway of its own (#2233 would otherwise refuse it).
    expect(params.allowPlatformSms).toBe(true);
    expect(params.body).toContain('স্বাগতম'); // bn template
    const logs = await ds.query(
      `SELECT recipient_address, status, tenant_id, metadata FROM communication_logs WHERE tenant_id = $1`,
      [a],
    );
    expect(logs).toEqual([
      {
        recipient_address: admin,
        status: 'SENT',
        tenant_id: a,
        metadata: { kind: 'welcome', provider: 'smtp', source: 'platform' },
      },
    ]);
  });

  it('support_emergency sends SMS and email; emailOnly sends no SMS; exceptUserId skips that admin', async () => {
    const id = await school('en-BD');
    const keep = randomUUID();
    const skip = randomUUID();
    for (const [uid, tag] of [
      [keep, 'keep'],
      [skip, 'skip'],
    ]) {
      await ds.getRepository(User).save({
        id: uid,
        email: `${tag}-${uid}@notice.test`,
        phone: `017${uid.replace(/\D/g, '').padEnd(8, '1').slice(0, 8)}`,
        password_hash: 'x',
        full_name: tag,
        status: UserStatus.ACTIVE,
      });
      await ds
        .getRepository(UserTenant)
        .save({ user_id: uid, tenant_id: id, role: UserRole.ADMIN });
    }
    const vars = { person: 'Rafi', role: 'Admin', reason: 'Fee help', time: '10:00' };

    send.mockClear();
    await svc.notifyAdmins(id, 'support_emergency', vars);
    expect(send).toHaveBeenCalledTimes(4); // 2 admins x (email + SMS)

    send.mockClear();
    await svc.notifyAdmins(
      id,
      'support_mode_changed',
      { ...vars, mode: 'off' },
      {
        emailOnly: true,
        exceptUserId: skip,
      },
    );
    expect(send).toHaveBeenCalledTimes(1); // one admin, email only
    expect(send.mock.calls[0][0].to).toBe(`keep-${keep}@notice.test`);
  });

  it('renders bn for bn-BD and for no stored region (the bn-BD default), en for en-BD (#3041)', async () => {
    send.mockClear();
    const bn = await school('bn-BD');
    const unset = await school();
    const en = await school('en-BD');
    await member(bn, UserRole.ADMIN, UserStatus.ACTIVE, 'admin-bn');
    await member(unset, UserRole.ADMIN, UserStatus.ACTIVE, 'admin-unset');
    await member(en, UserRole.ADMIN, UserStatus.ACTIVE, 'admin-en');

    await svc.notifyAdmins(bn, 'welcome');
    await svc.notifyAdmins(unset, 'welcome');
    await svc.notifyAdmins(en, 'welcome');

    expect(send.mock.calls[0][0].body).toContain('স্বাগতম');
    expect(send.mock.calls[1][0].body).toContain('স্বাগতম');
    expect(send.mock.calls[2][0].body).toContain('Welcome!');
  });

  const checkMoneyNotice = async (
    key: 'coupon_applied' | 'refund_done' | 'plan_changed',
    vars: Record<string, string>,
    token: string,
    bnWord: string,
  ) => {
    expect(renderNotice(key, 'en', { school: 'S', ...vars }).body).toContain(token);
    expect(renderNotice(key, 'bn', { school: 'S', ...vars }).body).toContain(bnWord);

    const id = await school('bn');
    const uid = randomUUID();
    await ds.getRepository(User).save({
      id: uid,
      email: `money-${uid}@notice.test`,
      phone: `017${uid.replace(/\D/g, '').padEnd(8, '1').slice(0, 8)}`,
      password_hash: 'x',
      full_name: 'money',
      status: UserStatus.ACTIVE,
    });
    await ds.getRepository(UserTenant).save({ user_id: uid, tenant_id: id, role: UserRole.ADMIN });

    send.mockClear();
    await svc.notifyAdmins(id, key, vars, { emailOnly: true });
    expect(send).toHaveBeenCalledTimes(1); // email only, no SMS
    expect(send.mock.calls[0][0].to).toBe(`money-${uid}@notice.test`);
    expect(send.mock.calls[0][0].body).toContain(bnWord);
    const logs = await ds.query(
      `SELECT metadata->>'kind' AS kind FROM communication_logs WHERE tenant_id = $1`,
      [id],
    );
    expect(logs).toEqual([{ kind: key }]);

    send.mockRejectedValueOnce(new Error('provider down'));
    await expect(svc.notifyAdmins(id, key, vars, { emailOnly: true })).resolves.toBeUndefined();
  };

  it('coupon_applied renders en and bn, goes by email only, logs a row, and never throws on a provider failure', () =>
    checkMoneyNotice(
      'coupon_applied',
      { coupon: 'E2E-HALF', amount: '500.00' },
      'E2E-HALF',
      'কুপন',
    ));

  it('refund_done renders en and bn, goes by email only, logs a row, and never throws on a provider failure', () =>
    checkMoneyNotice('refund_done', { amount: '1500.00' }, '1500.00', 'ফেরত'));

  it('plan_changed renders en and bn, goes by email only, logs a row, and never throws on a provider failure', () =>
    checkMoneyNotice('plan_changed', { plan: 'Plus' }, 'Plus', 'প্ল্যান'));
});

describe('sms_expiring notices and receipt wording', () => {
  it('both keys render in en and bn, with and without link', () => {
    for (const key of ['sms_expiring_d7', 'sms_expiring_d1'] as const) {
      for (const locale of ['en', 'bn'] as const) {
        const withLink = renderNotice(key, locale, {
          school: 'X',
          date: '2027-01-08',
          units: 40,
          link: 'https://a.test/l',
        });
        expect(withLink.subject).toContain('X');
        expect(withLink.body).toContain('2027-01-08');
        expect(withLink.body).toContain('https://a.test/l');
        expect(withLink.body).not.toMatch(/ledger|\blot\b/i);
        const noLink = renderNotice(key, locale, { school: 'X' });
        expect(noLink.body).not.toContain('undefined');
      }
    }
  });

  it('receipt keeps receipt number and link and no longer says seats only', () => {
    for (const locale of ['en', 'bn'] as const) {
      const r = renderNotice('receipt', locale, { school: 'X', receipt: 'SMR-1', link: 'L1' });
      expect(r.body).toContain('SMR-1');
      expect(r.body).toContain('L1');
      expect(r.body).not.toMatch(/seats of|সিটের/);
    }
  });
});
