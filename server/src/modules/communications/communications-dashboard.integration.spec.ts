import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { makeMeteredCreditService } from '@test/helpers/sms-credit-ledger.helper';
import { SmsCreditService } from './credits/sms-credit.service';
import { CommunicationLog } from './entities/communication-log.entity';
import { CommunicationsDashboardService } from './communications-dashboard.service';

/**
 * [8.10.7.2.06] The two ADMIN widgets against the real, migrated schema.
 * The cache is a pass-through stub: caching itself is covered by
 * `dashboard-cache.service.integration.spec.ts`.
 */
describe('CommunicationsDashboardService (integration)', () => {
  let dataSource: DataSource;
  let credits: SmsCreditService;
  let service: CommunicationsDashboardService;
  let tenantA: string;
  let tenantB: string;

  const passThroughCache = { getOrLoad: (_t: string, _k: string, _s: string, load: any) => load() };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(getDataSourceToken());
    credits = makeMeteredCreditService(dataSource);
    service = new CommunicationsDashboardService(
      module.get(getRepositoryToken(CommunicationLog)),
      credits,
      passThroughCache as any,
    );
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function makeSchool(name: string): Promise<string> {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), $1, 'dash-comm-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
      [name],
    );
    return id;
  }

  function addLog(tenantId: string, medium: string, status: string, createdAt: string) {
    return dataSource.query(
      `INSERT INTO communication_logs
         (tenant_id, medium, recipient_address, recipient_name, message_body, status, created_at, updated_at)
       VALUES ($1, $2, '01700000000', 'Test', 'hi', $3, $4, $4)`,
      [tenantId, medium, status, createdAt],
    );
  }

  beforeEach(async () => {
    // Wednesday 2026-10-07, 16:00 in Dhaka. Only Date is faked: timers and I/O stay real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    tenantA = await makeSchool('Dash Comm A');
    tenantB = await makeSchool('Dash Comm B');
  });

  afterEach(async () => {
    vi.useRealTimers();
    await dataSource.query(`DELETE FROM "schools" WHERE id IN ($1, $2)`, [tenantA, tenantB]);
  });

  describe('sms-balance', () => {
    it('equals getCreditsSummary after a grant and a reservation', async () => {
      await credits.grant(tenantA, 1300, { idempotencyKey: `grant-${tenantA}` });
      await credits.reserve(tenantA, 60, `reserve-${tenantA}`);

      const widget = await service.getSmsBalance(tenantA);
      const summary = await credits.getCreditsSummary(tenantA, 1, 1);

      expect(widget).toEqual({
        metering: summary.metering,
        available: summary.available,
        reserved: summary.reserved,
      });
      expect(widget).toEqual({ metering: 'PLATFORM', available: 1240, reserved: 60 });
    });

    it('with metering OFF returns zeros', async () => {
      const off = new SmsCreditService(
        null as any,
        null as any,
        null as any,
        {
          getResolvedSettings: async () => ({ communications: { sms: { metering: 'OFF' } } }),
        } as any,
      );
      const offService = new CommunicationsDashboardService(
        dataSource.getRepository(CommunicationLog),
        off,
        passThroughCache as any,
      );
      expect(await offService.getSmsBalance(tenantA)).toEqual({
        metering: 'OFF',
        available: 0,
        reserved: 0,
      });
    });
  });

  describe('failed-messages', () => {
    it('counts failed SMS from today and 6 days ago, not 7 days ago, not email or sent SMS', async () => {
      await addLog(tenantA, 'SMS', 'FAILED', '2026-10-07T09:00:00Z'); // today
      await addLog(tenantA, 'SMS', 'FAILED', '2026-10-01T05:00:00Z'); // 6 days ago (Dhaka 1 Oct)
      await addLog(tenantA, 'SMS', 'FAILED', '2026-09-30T05:00:00Z'); // 7 days ago: out
      await addLog(tenantA, 'EMAIL', 'FAILED', '2026-10-07T09:00:00Z'); // wrong medium
      await addLog(tenantA, 'SMS', 'SENT', '2026-10-07T09:00:00Z'); // wrong status

      expect(await service.getFailedMessages(tenantA)).toEqual({
        failed: 2,
        window: { from: '2026-10-01', to: '2026-10-07' },
      });
    });

    it('the window starts at Dhaka midnight, not UTC midnight', async () => {
      await addLog(tenantA, 'SMS', 'FAILED', '2026-09-30T18:30:00Z'); // 00:30 Dhaka, 1 Oct: in
      await addLog(tenantA, 'SMS', 'FAILED', '2026-09-30T17:30:00Z'); // 23:30 Dhaka, 30 Sep: out

      expect((await service.getFailedMessages(tenantA)).failed).toBe(1);
    });

    it("never counts another tenant's failures", async () => {
      await addLog(tenantB, 'SMS', 'FAILED', '2026-10-07T09:00:00Z');

      expect((await service.getFailedMessages(tenantA)).failed).toBe(0);
      expect((await service.getFailedMessages(tenantB)).failed).toBe(1);
    });
  });
});
