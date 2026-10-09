import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID as TENANT_ID } from '@test/constants';
import {
  balanceFor,
  ledgerFor,
  makeMeteredCreditService,
  makeProcessor,
  runJob,
} from '@test/helpers/sms-credit-ledger.helper';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { CommunicationsService } from '../communications/communications.service';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { IncidentNotifyListener, INCIDENT_NOTIFICATION_TEXT } from './incident-notify.listener';
import { CommunicationStatus, UserStatus, countSmsSegments } from '@biddaloy/shared';

/**
 * [#1317] Incident SMS against the REAL credit ledger. The listener reserves
 * once per incident (`batch:incident:<id>`), `CommunicationsService.enqueue`
 * hands each recipient a job, and the real worker settles under the same key.
 * Memberships/school settings are stubbed; everything money-related is real.
 */
describe('IncidentNotifyListener metered SMS credit (integration, #1317)', () => {
  let dataSource: DataSource;
  let logRepo: Repository<CommunicationLog>;
  let credits: SmsCreditService;
  let listener: IncidentNotifyListener;
  let queuedJobs: Array<{ name: string; data: any }>;
  let failAdd: boolean;

  const INCIDENT_ID = '00000000-0000-4000-8000-0000000b1317';
  const EVENT = {
    incidentId: INCIDENT_ID,
    tenantId: TENANT_ID,
    staffUserId: 'subject-user',
    reportedBy: SEED_ADMIN_USER_ID,
  } as any;
  const holder = (id: string, phone: string) => ({
    user_id: id,
    user: { id, status: UserStatus.ACTIVE, full_name: id, phone },
  });
  const units = countSmsSegments(INCIDENT_NOTIFICATION_TEXT).segments;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [], []);
    dataSource = module.get<DataSource>(getDataSourceToken());
    logRepo = module.get(getRepositoryToken(CommunicationLog));
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    queuedJobs = [];
    failAdd = false;
    credits = makeMeteredCreditService(dataSource);
    await credits.grant(TENANT_ID, 100, { idempotencyKey: 'seed:incident' });

    const communications = new CommunicationsService(
      logRepo,
      {
        add: async (name: string, data: any) => {
          if (failAdd) throw new Error('redis down');
          queuedJobs.push({ name, data });
        },
      } as any,
      { findOne: async () => ({}) } as any,
      { findOne: async () => ({}) } as any,
      credits,
    );
    listener = new IncidentNotifyListener(
      { find: async () => [holder('u1', '+8801700000001'), holder('u2', '+8801700000002')] } as any,
      {
        findOne: async () => ({
          id: TENANT_ID,
          settings: {
            evaluations: { incidentSmsEnabled: true },
            communications: { sms: { provider: 'test', metering: 'PLATFORM' } },
          },
        }),
      } as any,
      { sendToUser: async () => ({ accepted: 0, transient: 0, pruned: 0 }) } as any,
      communications,
      credits,
    );
  }, 30000);

  it('reserves one batch:incident:<id> for all recipients; worker DEBITs each log against it', async () => {
    await listener.handleIncidentCreated(EVENT);

    const reserves = (await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'RESERVE');
    expect(reserves.map((r) => [r.idempotency_key, r.units])).toEqual([
      [`batch:incident:${INCIDENT_ID}`, units * 2],
    ]);
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({
      available: 100 - units * 2,
      reserved: units * 2,
    });
    expect(queuedJobs.map((j) => [j.data.batchId, j.data.segments])).toEqual([
      [`incident:${INCIDENT_ID}`, units],
      [`incident:${INCIDENT_ID}`, units],
    ]);

    const processor = makeProcessor(dataSource, credits, 'ACCEPTED');
    for (const job of queuedJobs) await runJob(processor, job.data);

    expect((await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'DEBIT')).toHaveLength(
      2,
    );
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({
      available: 100 - units * 2,
      reserved: 0,
    });
  });

  it('REJECTED provider outcome releases every share', async () => {
    await listener.handleIncidentCreated(EVENT);
    const processor = makeProcessor(dataSource, credits, 'REJECTED');
    for (const job of queuedJobs) await runJob(processor, job.data);

    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({ available: 100, reserved: 0 });
  });

  it('queue.add failure releases each recipient share under log:<id>:settle', async () => {
    failAdd = true;
    await listener.handleIncidentCreated(EVENT);

    const logs = await logRepo.find({ where: { tenant_id: TENANT_ID } });
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.status === CommunicationStatus.FAILED)).toBe(true);
    const release = (await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'RELEASE');
    expect(release.map((r) => r.idempotency_key).sort()).toEqual(
      logs.map((l) => `log:${l.id}:settle`).sort(),
    );
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({ available: 100, reserved: 0 });
  });
});
