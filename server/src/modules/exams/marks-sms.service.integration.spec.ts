import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { MarkGridState } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { ReminderBatch } from '../communications/entities/reminder-batch.entity';
import { makeMarksSms, seedGrid, SEED_ADMIN_USER_ID, TENANT_ID } from './marks-sms.fixture';

describe('MarksSmsService (integration, unmetered)', () => {
  let ds: DataSource;
  let jobs: any[];

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [], []);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  // Unmetered school: reserve is never called, jobs carry no segments.
  const make = () => {
    jobs = [];
    const credits = { isMetered: async () => false } as unknown as SmsCreditService;
    return makeMarksSms(ds, credits, {
      add: async (_n, d) => {
        jobs.push(d);
      },
    });
  };

  it('refuses a DRAFT grid', async () => {
    const { grid } = await seedGrid(ds, 1, MarkGridState.DRAFT);
    await expect(make().send(grid.id, TENANT_ID, SEED_ADMIN_USER_ID)).rejects.toThrow(
      /not submitted/,
    );
    expect(
      await ds.getRepository(CommunicationLog).count({ where: { tenant_id: TENANT_ID } }),
    ).toBe(0);
  });

  it('preview and send agree on count and segments', async () => {
    const { grid } = await seedGrid(ds, 2);
    const service = make();
    const p = await service.preview(grid.id, TENANT_ID);
    const o = await service.send(grid.id, TENANT_ID, SEED_ADMIN_USER_ID);
    expect([o.queued, o.segments, o.skipped]).toEqual([p.count, p.segments, p.skipped]);
    expect(jobs.every((j) => j.segments === undefined && j.batchId === undefined)).toBe(true);
    const logs = await ds.getRepository(CommunicationLog).find({ where: { tenant_id: TENANT_ID } });
    expect(logs.every((l) => l.trigger === 'MARKS_SMS' && l.reminder_batch_id)).toBe(true);
  });

  it('two concurrent sends leave one log per (student, guardian) — unique key blocks duplicates', async () => {
    const { grid } = await seedGrid(ds, 2);
    const service = make();
    await Promise.all([
      service.send(grid.id, TENANT_ID, SEED_ADMIN_USER_ID),
      service.send(grid.id, TENANT_ID, SEED_ADMIN_USER_ID),
    ]);
    expect(
      await ds.getRepository(CommunicationLog).count({ where: { tenant_id: TENANT_ID } }),
    ).toBe(2);
    // The loser's failed enqueue is counted on its batch, so it cannot stick at PROCESSING.
    const batches = await ds.getRepository(ReminderBatch).find({ where: { tenant_id: TENANT_ID } });
    expect(batches.length).toBeGreaterThanOrEqual(1);
  });
});
