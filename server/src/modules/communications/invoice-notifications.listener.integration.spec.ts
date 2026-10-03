import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
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
import { CommunicationLog } from './entities/communication-log.entity';
import { School } from '../schools/entities/school.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { Student } from '../students/entities/student.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Payment } from '../fees/entities/payment.entity';
import { SmsCreditService } from './credits/sms-credit.service';
import { InvoiceNotificationsListener } from './invoice-notifications.listener';
import {
  CommunicationMedium,
  CommunicationStatus,
  InvoiceStatus,
  PaymentMethod,
  countSmsSegments,
} from '@biddaloy/shared';

/**
 * [#1317] Payment-received SMS against the REAL credit ledger: the listener
 * reserves, the real `CommunicationsProcessor` settles. Proves the reserve
 * key (`batch:<bare id>`) is the one the worker settles under, and that a
 * `queue.add` failure holds the units for the replay instead of releasing.
 */
describe('InvoiceNotificationsListener metered SMS credit (integration, #1317)', () => {
  let dataSource: DataSource;
  let logRepo: Repository<CommunicationLog>;
  let credits: SmsCreditService;
  let queuedJobs: Array<{ name: string; data: any }>;
  let failAdd: boolean;
  let listener: InvoiceNotificationsListener;

  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000001317';

  let paymentId: string;
  let guardianId: string;
  let studentId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [], []);
    dataSource = module.get<DataSource>(getDataSourceToken());
    logRepo = module.get(getRepositoryToken(CommunicationLog));
    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT_ID } }))) {
      await schoolRepo.save({ id: OTHER_TENANT_ID, name: 'Other 1317', slug: 'other-1317' });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    queuedJobs = [];
    failAdd = false;
    credits = makeMeteredCreditService(dataSource);
    await credits.grant(TENANT_ID, 100, { idempotencyKey: 'seed:payment-notify' });

    listener = new InvoiceNotificationsListener(
      logRepo,
      dataSource,
      {
        add: async (name: string, data: any) => {
          if (failAdd) throw new Error('redis down');
          queuedJobs.push({ name, data });
        },
      } as any,
      {
        getResolvedSettings: async () => ({
          communications: { sms: { metering: 'PLATFORM', provider: 'test' } },
          region: { locale: 'en-US' },
        }),
      } as any,
      credits,
      { createToken: async () => ({ rawToken: 'tok' }) } as any,
      { get: () => undefined } as any,
    );

    const guardian = await dataSource.getRepository(Guardian).save({
      full_name: 'Guardian 1317',
      relationship: 'Father',
      phone: '01711111111',
      is_primary_contact: true,
      notifications_enabled: true,
      preferred_communication: CommunicationMedium.SMS,
      tenant_id: TENANT_ID,
    });
    const student = await dataSource.getRepository(Student).save({
      full_name: 'Student 1317',
      registration_number: `PN-${Date.now()}-${Math.random()}`,
      roll_number: Math.floor(Math.random() * 100000),
      class_section_id: SEED_SECTION_1_ID,
      tenant_id: TENANT_ID,
      guardians: [guardian],
    });
    guardianId = guardian.id;
    studentId = student.id;

    const payment = await dataSource.getRepository(Payment).save({
      student_id: studentId,
      total_amount: 1000,
      payment_method: PaymentMethod.CASH,
      payment_date: new Date(),
      tenant_id: TENANT_ID,
      received_by_user_id: SEED_ADMIN_USER_ID,
    });
    const invoice = await dataSource.getRepository(Invoice).save({
      invoice_number: `INV-1317-${Date.now()}-${Math.random()}`,
      student_id: studentId,
      payment_id: payment.id,
      total_amount: 1000,
      status: InvoiceStatus.PAID,
      issued_date: new Date(),
      due_date: new Date(),
      issued_by_user_id: SEED_ADMIN_USER_ID,
      snapshot: { totals: { paid: 1000 } } as any,
    });
    await dataSource.getRepository(Payment).update({ id: payment.id }, { invoice_id: invoice.id });
    paymentId = payment.id;
  }, 30000);

  const fire = () =>
    listener.handlePaymentRecorded({
      payment_id: paymentId,
      tenant_id: TENANT_ID,
      student_ids: [studentId],
    } as any);

  it('reserves under batch:<reference_key>; worker DEBITs against it', async () => {
    await fire();

    const log = (await logRepo.find({ where: { guardian_id: guardianId } }))[0];
    expect(log.medium).toBe(CommunicationMedium.SMS);
    const units = countSmsSegments(log.message_body).segments;
    const bare = `payment-notify:${paymentId}:${guardianId}`;

    const reserves = (await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'RESERVE');
    expect(reserves.map((r) => [r.idempotency_key, r.units])).toEqual([[`batch:${bare}`, units]]);
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({
      available: 100 - units,
      reserved: units,
    });
    expect(queuedJobs.map((j) => j.data)).toEqual([
      { logId: log.id, batchId: bare, segments: units },
    ]);

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
    expect(((await logRepo.findOneByOrFail({ id: log.id })).metadata as any).credit).toBe(
      'DEBITED',
    );
  });

  it('REJECTED provider outcome releases the reservation', async () => {
    await fire();
    const log = (await logRepo.find({ where: { guardian_id: guardianId } }))[0];

    await runJob(makeProcessor(dataSource, credits, 'REJECTED'), queuedJobs[0].data);

    expect((await ledgerFor(dataSource, TENANT_ID)).some((r) => r.kind === 'RELEASE')).toBe(true);
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({ available: 100, reserved: 0 });
    expect(((await logRepo.findOneByOrFail({ id: log.id })).metadata as any).credit).toBe(
      'RELEASED',
    );
  });

  it('queue.add failure holds the units; a replay re-claims the same log and settles it', async () => {
    failAdd = true;
    await fire();

    const failed = (await logRepo.find({ where: { guardian_id: guardianId } }))[0];
    expect(failed.status).toBe(CommunicationStatus.FAILED);
    expect((failed.metadata as any).reason).toBe('ENQUEUE_FAILED');
    const units = countSmsSegments(failed.message_body).segments;
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({
      available: 100 - units,
      reserved: units,
    });

    failAdd = false;
    await fire();

    expect((await logRepo.find({ where: { guardian_id: guardianId } })).map((l) => l.id)).toEqual([
      failed.id,
    ]);
    expect(
      (await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'RESERVE'),
    ).toHaveLength(1);

    await runJob(makeProcessor(dataSource, credits, 'ACCEPTED'), queuedJobs[0].data);
    expect((await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'DEBIT')).toHaveLength(
      1,
    );
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({
      available: 100 - units,
      reserved: 0,
    });
  });

  it('push delivered instead of SMS releases the reservation (#1317)', async () => {
    // The worker tries push first for AUTOMATED logs; the guardian needs a linked user.
    await dataSource
      .getRepository(Guardian)
      .update({ id: guardianId }, { user_id: SEED_ADMIN_USER_ID });
    await fire();
    const log = (await logRepo.find({ where: { guardian_id: guardianId } }))[0];
    const units = countSmsSegments(log.message_body).segments;
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({
      available: 100 - units,
      reserved: units,
    });

    await runJob(makeProcessor(dataSource, credits, 'ACCEPTED', 1), queuedJobs[0].data);

    const settled = await logRepo.findOneByOrFail({ id: log.id });
    expect(settled.medium).toBe('PUSH');
    expect((settled.metadata as any).credit).toBe('RELEASED');
    expect(
      (await ledgerFor(dataSource, TENANT_ID))
        .filter((r) => r.kind === 'RELEASE')
        .map((r) => r.idempotency_key),
    ).toEqual([`log:${log.id}:settle`]);
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({ available: 100, reserved: 0 });
  });

  it('a replayed job for a log already PUSH/SENT with no credit disposition still releases (crash recovery)', async () => {
    await fire();
    const log = (await logRepo.find({ where: { guardian_id: guardianId } }))[0];
    // State a worker leaves if it dies after the push-first settle, before the release.
    await logRepo.update(
      { id: log.id },
      { medium: 'PUSH' as any, status: CommunicationStatus.SENT },
    );

    await runJob(makeProcessor(dataSource, credits, 'ACCEPTED'), queuedJobs[0].data);

    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({ available: 100, reserved: 0 });
    expect(((await logRepo.findOneByOrFail({ id: log.id })).metadata as any).credit).toBe(
      'RELEASED',
    );
  });

  it("leaves another tenant's balance and ledger untouched", async () => {
    await credits.grant(OTHER_TENANT_ID, 50, { idempotencyKey: 'seed:payment-notify-other' });
    const otherBefore = await ledgerFor(dataSource, OTHER_TENANT_ID);

    await fire();
    await runJob(makeProcessor(dataSource, credits, 'ACCEPTED'), queuedJobs[0].data);

    expect(await balanceFor(dataSource, OTHER_TENANT_ID)).toEqual({ available: 50, reserved: 0 });
    expect(await ledgerFor(dataSource, OTHER_TENANT_ID)).toEqual(otherBefore);
  });
});
