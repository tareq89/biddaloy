import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  balanceFor,
  ledgerFor,
  makeMeteredCreditService,
  makeProcessor,
  runJob,
} from '@test/helpers/sms-credit-ledger.helper';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { ReminderBatch } from '../communications/entities/reminder-batch.entity';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { makeMarksSms, seedGrid, SEED_ADMIN_USER_ID, TENANT_ID } from './marks-sms.fixture';

/** Marks SMS against the REAL credit ledger: reserve `batch:<ReminderBatch.id>`, worker settles. */
describe('MarksSmsService metered SMS credit (integration)', () => {
  let ds: DataSource;
  let credits: SmsCreditService;
  let queued: Array<{ name: string; data: any }>;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [], []);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  async function setup(credit: number) {
    queued = [];
    credits = makeMeteredCreditService(ds);
    await credits.grant(TENANT_ID, credit, { idempotencyKey: `seed:marks-sms:${Math.random()}` });
    const { grid } = await seedGrid(ds, 2);
    const service = makeMarksSms(ds, credits, {
      add: async (name, data) => {
        queued.push({ name, data });
      },
    });
    return { grid, service };
  }

  it('reserves total segments under batch:<batch.id>, jobs carry batchId+segments, worker debits', async () => {
    const { grid, service } = await setup(100);
    const out = await service.send(grid.id, TENANT_ID, SEED_ADMIN_USER_ID);
    expect(out.queued).toBe(2);

    const batches = await ds.getRepository(ReminderBatch).find({ where: { tenant_id: TENANT_ID } });
    expect(batches).toHaveLength(1);
    // D31: kind + grid id live in filters_applied.
    expect(batches[0].filters_applied).toMatchObject({ kind: 'MARKS_SMS', mark_grid_id: grid.id });
    const reserves = (await ledgerFor(ds, TENANT_ID)).filter((r) => r.kind === 'RESERVE');
    expect(reserves).toHaveLength(1);
    expect(reserves[0].idempotency_key).toBe(`batch:${batches[0].id}`);
    expect(reserves[0].units).toBe(out.segments);
    expect(queued.every((j) => j.data.batchId === batches[0].id && j.data.segments >= 1)).toBe(
      true,
    );

    const processor = makeProcessor(ds, credits, 'ACCEPTED');
    for (const j of queued) await runJob(processor, j.data);
    expect(await balanceFor(ds, TENANT_ID)).toEqual({
      available: 100 - out.segments,
      reserved: 0,
    });
  });

  it('REJECTED provider outcome releases every share', async () => {
    const { grid, service } = await setup(100);
    await service.send(grid.id, TENANT_ID, SEED_ADMIN_USER_ID);
    const processor = makeProcessor(ds, credits, 'REJECTED');
    for (const j of queued) await runJob(processor, j.data);
    expect(await balanceFor(ds, TENANT_ID)).toEqual({ available: 100, reserved: 0 });
  });

  it('short credit refuses the whole send and leaves no batch, no logs, no jobs', async () => {
    const { grid, service } = await setup(1); // two messages need at least 2 segments
    await expect(service.send(grid.id, TENANT_ID, SEED_ADMIN_USER_ID)).rejects.toMatchObject({
      response: { details: { code: expect.any(String), required: 2, available: 1 } },
    });
    expect(await ds.getRepository(ReminderBatch).count({ where: { tenant_id: TENANT_ID } })).toBe(
      0,
    );
    expect(
      await ds.getRepository(CommunicationLog).count({ where: { tenant_id: TENANT_ID } }),
    ).toBe(0);
    expect(queued).toHaveLength(0);
    expect(await balanceFor(ds, TENANT_ID)).toEqual({ available: 1, reserved: 0 });
  });

  it('a fully-sent grid reserves nothing on the second send', async () => {
    const { grid, service } = await setup(100);
    await service.send(grid.id, TENANT_ID, SEED_ADMIN_USER_ID);
    const second = await service.send(grid.id, TENANT_ID, SEED_ADMIN_USER_ID);
    expect(second.queued).toBe(0);
    expect(second.already_sent_at).toBeInstanceOf(Date);
    expect((await ledgerFor(ds, TENANT_ID)).filter((r) => r.kind === 'RESERVE')).toHaveLength(1);
  });
});
