import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID } from '@test/constants';
import { AuditService } from '../../audit/audit.service';
import { SessionCutoffService } from '../../auth/session-cutoff.service';
import { AdminNoticeService } from './admin-notice.service';
import { EntitlementService } from '../../billing/entitlement.service';
import { OrdersService } from '../../billing/orders.service';
import { School } from '../entities/school.entity';
import { TenantStatusService } from '../tenant-status.service';
import { TrialService } from './trial.service';

describe('TrialService (integration): account start and seat grants', () => {
  let ds: DataSource;
  let trial: TrialService;
  const tenantStatus = { invalidate: vi.fn().mockResolvedValue(undefined) };
  const originalFreeUntil = process.env.BILLING_FREE_UNTIL;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      TrialService,
      EntitlementService,
      OrdersService,
      AuditService,
      { provide: TenantStatusService, useValue: tenantStatus },
      { provide: SessionCutoffService, useValue: { cutOff: vi.fn() } },
      { provide: AdminNoticeService, useValue: { notifyAdmins: vi.fn() } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    trial = module.get(TrialService);
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  afterEach(() => {
    if (originalFreeUntil === undefined) delete process.env.BILLING_FREE_UNTIL;
    else process.env.BILLING_FREE_UNTIL = originalFreeUntil;
  });

  const newSchool = async (): Promise<string> => {
    const id = randomUUID();
    await ds.getRepository(School).save({
      id,
      tenant_id: id,
      name: `Acct ${id.slice(0, 6)}`,
      slug: `acct-${id.slice(0, 8)}`,
    });
    return id;
  };
  const load = (id: string) => ds.getRepository(School).findOneOrFail({ where: { id } });

  it('startAccount during the free period: no trial, unlimited seats', async () => {
    process.env.BILLING_FREE_UNTIL = '2999-01-01T00:00:00+06:00';
    const id = await newSchool();
    await ds.transaction((m) => trial.startAccount(id, m));
    const s = await load(id);
    expect(s.trial_ends_at).toBeNull();
    expect(s.seat_limit).toBeNull();
  });

  it('startAccount after the free period: no trial, zero seats until a purchase', async () => {
    process.env.BILLING_FREE_UNTIL = '2000-01-01T00:00:00+06:00';
    const id = await newSchool();
    await ds.transaction((m) => trial.startAccount(id, m));
    const s = await load(id);
    expect(s.trial_ends_at).toBeNull();
    expect(s.seat_limit).toBe(0);
  });

  it('grantSeats after the free period: PAID GRANT order, seat_limit set, audited', async () => {
    process.env.BILLING_FREE_UNTIL = '2000-01-01T00:00:00+06:00';
    const id = await newSchool();
    await ds.transaction((m) => trial.startAccount(id, m));

    const school = await trial.grantSeats(
      id,
      {
        seats: 15,
        months: 2,
        reason: 'Pilot school, agreed with the owner',
        idempotency_key: 'grant-key-0001',
      },
      { userId: SEED_ADMIN_USER_ID },
    );

    expect(school.seat_limit).toBe(15);
    const [order] = await ds.query(
      `SELECT o.status, o.seats, p.method, p.amount_paisa
         FROM seat_orders o JOIN platform_payments p ON p.seat_order_id = o.id
        WHERE o.school_id = $1`,
      [id],
    );
    expect(order).toEqual({ status: 'PAID', seats: 15, method: 'GRANT', amount_paisa: '0' });
    const audits = await ds.query(
      `SELECT new_values->>'event' AS event FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`,
      [id],
    );
    expect(audits.map((a: { event: string }) => a.event)).toEqual(
      expect.arrayContaining(['SEATS_GRANTED', 'SEAT_LIMIT_RECOMPUTED']),
    );
  });
});
