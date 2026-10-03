import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
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
import { CommunicationLog } from '../entities/communication-log.entity';
import { Guardian } from '../../students/entities/guardian.entity';
import { SmsCreditService } from '../credits/sms-credit.service';
import {
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  countSmsSegments,
} from '@biddaloy/shared';

/**
 * [#1317] Push replaces the reserved SMS: the worker must RELEASE that log's share
 * of the batch reservation, for the fee and calendar producers' key shapes, against
 * the real ledger and processor.
 */
describe('push-delivered SMS job releases its credit share (integration, #1317)', () => {
  let dataSource: DataSource;
  let credits: SmsCreditService;
  // 2 SMS segments, so the released amount is segments, not 1 per recipient.
  const BODY = 'x'.repeat(200);
  const SEGMENTS = countSmsSegments(BODY).segments;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [], []);
    dataSource = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    credits = makeMeteredCreditService(dataSource);
    await credits.grant(TENANT_ID, 100, { idempotencyKey: 'seed:push-release' });
  }, 30000);

  async function queuedPushLog(): Promise<CommunicationLog> {
    const guardian = await dataSource.getRepository(Guardian).save({
      tenant_id: TENANT_ID,
      full_name: 'Push Guardian',
      relationship: 'Mother',
      phone: '01711111111',
      user_id: SEED_ADMIN_USER_ID,
    } as Guardian);
    return dataSource.getRepository(CommunicationLog).save({
      tenant_id: TENANT_ID,
      medium: CommunicationMedium.SMS,
      recipient_address: '+8801711111111',
      recipient_name: 'Push Guardian',
      message_body: BODY,
      guardian_id: guardian.id,
      status: CommunicationStatus.QUEUED,
      trigger: CommunicationTrigger.AUTOMATED,
    } as CommunicationLog);
  }

  async function expectPushReleases(bare: string, ref: string | null) {
    const log = await queuedPushLog();
    expect(
      await credits.reserve(TENANT_ID, SEGMENTS, `batch:${bare}`, { type: 'batch', id: ref }),
    ).toEqual({ ok: true });
    const processor = makeProcessor(dataSource, credits, 'ACCEPTED', 1);
    const data = { logId: log.id, batchId: bare, segments: SEGMENTS };

    await runJob(processor, data);
    await runJob(processor, data); // replay is a no-op

    const release = (await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'RELEASE');
    expect(release.map((r) => [r.idempotency_key, r.units])).toEqual([
      [`log:${log.id}:settle`, SEGMENTS],
    ]);
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({ available: 100, reserved: 0 });
    const after = await dataSource.getRepository(CommunicationLog).findOneByOrFail({ id: log.id });
    expect(after.medium).toBe('PUSH');
  }

  it('fee: push acceptance releases the log share under log:<id>:settle, once', async () => {
    await expectPushReleases('fee-notify:77777777-7777-4777-8777-777777777777:sms', null);
  });

  it('calendar: push acceptance releases the log share under log:<id>:settle, once', async () => {
    const id = '88888888-8888-4888-8888-888888888888';
    await expectPushReleases(id, id);
  });
});
