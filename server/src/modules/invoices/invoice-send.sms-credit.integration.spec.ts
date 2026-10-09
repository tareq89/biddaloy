import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { InternalServerErrorException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_TENANT_ID as TENANT_ID,
} from '@test/constants';
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
import { School } from '../schools/entities/school.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { Student } from '../students/entities/student.entity';
import { InvoicesController } from './invoices.controller';
import { CommunicationMedium, CommunicationStatus, countSmsSegments } from '@biddaloy/shared';

/**
 * [#1317] `POST /invoices/:id/send` over SMS against the REAL credit
 * ledger, through the real `CommunicationsService.enqueue`. The worker is the
 * real `CommunicationsProcessor`, so the reserve key is proven against what
 * it settles under.
 */
describe('InvoicesController.sendInvoice metered SMS credit (integration, #1317)', () => {
  let dataSource: DataSource;
  let logRepo: Repository<CommunicationLog>;
  let credits: SmsCreditService;
  let controller: InvoicesController;
  let queuedJobs: Array<{ name: string; data: any }>;
  let failAdd: boolean;
  let failSave: boolean;

  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000001318';
  const INVOICE_ID = '00000000-0000-4000-8000-0000000a1317';
  const tenant = { id: TENANT_ID, role: 'ADMIN' };
  const user = { sub: SEED_ADMIN_USER_ID } as any;

  let guardianId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [], []);
    dataSource = module.get<DataSource>(getDataSourceToken());
    logRepo = module.get(getRepositoryToken(CommunicationLog));
    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT_ID } }))) {
      await schoolRepo.save({ id: OTHER_TENANT_ID, name: 'Other 1318', slug: 'other-1318' });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    queuedJobs = [];
    failAdd = false;
    failSave = false;
    credits = makeMeteredCreditService(dataSource);
    await credits.grant(TENANT_ID, 100, { idempotencyKey: 'seed:invoice-send' });

    const guardian = await dataSource.getRepository(Guardian).save({
      full_name: 'Guardian Send',
      relationship: 'Father',
      phone: '01722222222',
      is_primary_contact: true,
      notifications_enabled: true,
      preferred_communication: CommunicationMedium.SMS,
      tenant_id: TENANT_ID,
    });
    const student = await dataSource.getRepository(Student).save({
      full_name: 'Student Send',
      registration_number: `IS-${Date.now()}-${Math.random()}`,
      roll_number: Math.floor(Math.random() * 100000),
      class_section_id: SEED_SECTION_1_ID,
      tenant_id: TENANT_ID,
      guardians: [guardian],
    });
    guardianId = guardian.id;

    const studentService = {
      findOne: async () => ({ id: student.id, guardians: [guardian] }),
    } as any;
    const guardianService = { findOne: async () => guardian } as any;

    // Real log repo, except `save` can be made to fail to exercise the
    // pre-queue.add release path.
    const repo = {
      create: logRepo.create.bind(logRepo),
      save: (entity: any) =>
        failSave ? Promise.reject(new Error('db down')) : logRepo.save(entity),
    } as any;
    const communications = new CommunicationsService(
      repo,
      {
        add: async (name: string, data: any) => {
          if (failAdd) throw new Error('redis down');
          queuedJobs.push({ name, data });
        },
      } as any,
      studentService,
      guardianService,
      credits,
    );

    controller = new InvoicesController(
      {
        findOne: async () => ({
          id: INVOICE_ID,
          student_id: student.id,
          invoice_number: 'INV-1317',
          snapshot: { totals: { paid: 1000 } },
        }),
      } as any,
      {} as any,
      { createToken: async () => ({ rawToken: 'tok' }) } as any,
      { get: () => undefined } as any,
      studentService,
      guardianService,
      communications,
      credits,
      {
        getResolvedSettings: async () => ({
          communications: { sms: { metering: 'PLATFORM', provider: 'test' } },
          region: { locale: 'en-US' },
        }),
      } as any,
    );
  }, 30000);

  const send = () =>
    controller.sendInvoice(
      INVOICE_ID,
      { medium: CommunicationMedium.SMS, guardian_id: guardianId } as any,
      tenant,
      user,
    );

  it('reserves under batch:<batchId>; worker DEBITs against it', async () => {
    await send();

    const log = (await logRepo.find({ where: { guardian_id: guardianId } }))[0];
    const units = countSmsSegments(log.message_body).segments;
    const reserves = (await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'RESERVE');
    expect(reserves).toHaveLength(1);
    expect(reserves[0].units).toBe(units);
    const bare = queuedJobs[0].data.batchId as string;
    expect(bare).toMatch(new RegExp(`^invoice-send:${INVOICE_ID}:${guardianId}:`));
    expect(reserves[0].idempotency_key).toBe(`batch:${bare}`);
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({
      available: 100 - units,
      reserved: units,
    });

    await runJob(makeProcessor(dataSource, credits, 'ACCEPTED'), queuedJobs[0].data);

    expect(
      (await ledgerFor(dataSource, TENANT_ID))
        .filter((r) => r.kind === 'DEBIT')
        .map((r) => [r.idempotency_key, r.units]),
    ).toEqual([[`log:${log.id}:settle`, units]]);
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({
      available: 100 - units,
      reserved: 0,
    });
    expect(((await logRepo.findOneByOrFail({ id: log.id })).metadata as any)?.credit).toBe(
      'DEBITED',
    );
  });

  it('REJECTED provider outcome releases the reservation', async () => {
    await send();
    await runJob(makeProcessor(dataSource, credits, 'REJECTED'), queuedJobs[0].data);

    expect((await ledgerFor(dataSource, TENANT_ID)).some((r) => r.kind === 'RELEASE')).toBe(true);
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({ available: 100, reserved: 0 });
  });

  it('queue.add failure releases the reservation under log:<id>:settle', async () => {
    failAdd = true;
    await expect(send()).rejects.toThrow(InternalServerErrorException);

    const log = (await logRepo.find({ where: { guardian_id: guardianId } }))[0];
    expect(log.status).toBe(CommunicationStatus.FAILED);
    const release = (await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'RELEASE');
    expect(release.map((r) => r.idempotency_key)).toEqual([`log:${log.id}:settle`]);
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({ available: 100, reserved: 0 });
  });

  it('a log-save failure (before any job exists) releases under an enqueue-failed: key', async () => {
    failSave = true;
    await expect(send()).rejects.toThrow('db down');

    const release = (await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'RELEASE');
    expect(release).toHaveLength(1);
    expect(release[0].idempotency_key).toMatch(/^enqueue-failed:.+:settle$/);
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({ available: 100, reserved: 0 });
    expect(queuedJobs).toHaveLength(0);
  });

  it('re-sending the same invoice to the same guardian reserves and charges again', async () => {
    await send();
    await send();

    const units = countSmsSegments(
      (await logRepo.find({ where: { guardian_id: guardianId } }))[0].message_body,
    ).segments;
    expect(
      (await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'RESERVE'),
    ).toHaveLength(2);

    const processor = makeProcessor(dataSource, credits, 'ACCEPTED');
    for (const job of queuedJobs) await runJob(processor, job.data);

    expect((await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'DEBIT')).toHaveLength(
      2,
    );
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({
      available: 100 - 2 * units,
      reserved: 0,
    });
  });

  it("leaves another tenant's balance and ledger untouched", async () => {
    await credits.grant(OTHER_TENANT_ID, 50, { idempotencyKey: 'seed:invoice-send-other' });
    const otherBefore = await ledgerFor(dataSource, OTHER_TENANT_ID);

    await send();
    await runJob(makeProcessor(dataSource, credits, 'ACCEPTED'), queuedJobs[0].data);

    expect(await balanceFor(dataSource, OTHER_TENANT_ID)).toEqual({ available: 50, reserved: 0 });
    expect(await ledgerFor(dataSource, OTHER_TENANT_ID)).toEqual(otherBefore);
  });
});
