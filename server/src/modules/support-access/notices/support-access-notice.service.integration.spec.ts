import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { CommunicationProviderRegistryService } from '../../communications/providers/communication-provider.registry';
import { AdminNoticeService } from '../../schools/trial/admin-notice.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';
import { SupportAccessNoticeService } from './support-access-notice.service';

describe('SupportAccessNoticeService (integration)', () => {
  let ds: DataSource;
  let svc: SupportAccessNoticeService;
  const ok = { success: true, providerMessageId: 'pm', provider: 'smtp', source: 'platform' };
  const send = vi.fn();
  const deliver = vi.fn().mockResolvedValue({});

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      AdminNoticeService,
      SupportAccessNoticeService,
      { provide: CommunicationProviderRegistryService, useValue: { resolve: () => ({ send }) } },
      { provide: AccountAccessDeliveryService, useValue: { deliver } },
      { provide: ConfigService, useValue: { get: () => undefined } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    svc = module.get(SupportAccessNoticeService);
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const entry = { person: 'Rafi', role: 'Admin', reason: 'Fee help', time: '10:00' };

  const schoolWithAdmins = async (
    statuses: UserStatus[],
  ): Promise<{ id: string; emails: string[] }> => {
    const id = randomUUID();
    await ds.getRepository(School).save({
      id,
      tenant_id: id,
      name: `Support ${id.slice(0, 6)}`,
      slug: `support-${id.slice(0, 8)}`,
      settings: { region: { locale: 'en-BD' } },
    });
    const emails: string[] = [];
    for (const status of statuses) {
      const uid = randomUUID();
      const email = `a-${uid}@notice.test`;
      emails.push(email);
      await ds.getRepository(User).save({
        id: uid,
        email,
        phone: null,
        password_hash: 'x',
        full_name: 'Admin',
        status,
      });
      await ds
        .getRepository(UserTenant)
        .save({ user_id: uid, tenant_id: id, role: UserRole.ADMIN });
    }
    return { id, emails };
  };

  it('sessionStarted emails active admins only; an inactive admin gets nothing', async () => {
    send.mockReset().mockResolvedValue(ok);
    const { id, emails } = await schoolWithAdmins([UserStatus.ACTIVE, UserStatus.INACTIVE]);
    await svc.sessionStarted(id, entry);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe(emails[0]);
    expect(send.mock.calls[0][0].body).not.toMatch(/\{\{|#/);
  });

  it('one failing recipient does not stop the rest, and the caller never sees the error', async () => {
    send.mockReset().mockRejectedValueOnce(new Error('gateway down')).mockResolvedValue(ok);
    const { id } = await schoolWithAdmins([UserStatus.ACTIVE, UserStatus.ACTIVE]);
    await expect(svc.sessionStarted(id, entry)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('owners notice reaches both owners', async () => {
    deliver.mockClear();
    await svc.ownersSessionStarted(
      [
        { name: 'Owner One', email: 'one@owner.test' },
        { name: 'Owner Two', email: 'two@owner.test' },
      ],
      { ...entry, targetSchool: 'Rose' },
    );
    expect(deliver.mock.calls.map((c) => c[0].to)).toEqual(['one@owner.test', 'two@owner.test']);
    expect(deliver.mock.calls.every((c) => c[0].tenantId === null)).toBe(true);
  });
});
