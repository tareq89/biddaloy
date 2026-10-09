import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { RESOLVERS } from '../catalog/field-resolver';
import { PrintJobsService } from './print-jobs.service';

/** [48.2.05] Typed issue values are frozen in the snapshot and survive reprints (real DB). */
describe('PrintJobsService issue values (integration)', () => {
  let ds: DataSource;
  let svc: PrintJobsService;
  let tenantId: string;
  let userId: string;
  let boundTpl: string;
  let plainTpl: string;
  const caller = () => ({ tenantId, userId, role: 'ADMIN', channel: 'CERTIFICATE' as const });
  const CONDUCT = 'তার আচরণ সন্তোষজনক';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    svc = new PrintJobsService(
      ds,
      {} as any,
      { record: async () => undefined } as any,
      { documentsSettings: async () => ({}) } as any,
    );
  });

  const one = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
  async function template(tid: string, kind: string, definition: object) {
    const t = await one(
      `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft)
       VALUES ($1, $2, $3, 50, '{}'::jsonb) RETURNING id`,
      [tid, kind, `${kind} ${randomUUID()}`],
    );
    const v = await one(
      `INSERT INTO print_template_versions (tenant_id, template_id, version, definition)
       VALUES ($1, $2, 1, $3::jsonb) RETURNING id`,
      [tid, t, JSON.stringify(definition)],
    );
    await ds.query(`UPDATE print_templates SET current_version_id = $1 WHERE id = $2`, [v, t]);
    return t;
  }

  beforeEach(async () => {
    tenantId = await one(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `IF ${randomUUID()}`,
      `if-${randomUUID()}`,
    ]);
    userId = await one(`INSERT INTO users (full_name, email) VALUES ('Clerk', $1) RETURNING id`, [
      `if-${randomUUID()}@example.com`,
    ]);
    const el = (field: string) => ({ type: 'TEXT', x: 0, y: 0, w: 10, h: 5, field });
    boundTpl = await template(tenantId, 'TESTIMONIAL', {
      front: { elements: [el('issue.conduct')] },
    });
    plainTpl = await template(tenantId, 'CHARACTER_CERTIFICATE', {
      front: { elements: [el('student.name')] },
    });
    for (const kind of ['TESTIMONIAL', 'CHARACTER_CERTIFICATE'] as const) {
      vi.spyOn(RESOLVERS[kind]!, 'resolve').mockImplementation(
        async (_t, ids) =>
          new Map(ids.map((i) => [i, { label: 'S-' + i.slice(0, 4), values: {}, photoKey: null }])),
      );
    }
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await ds.destroy();
  });

  const create = (template_id: string, ids: string[], issue_values?: Record<string, string>) =>
    svc.create(caller(), {
      template_id,
      subject_type: 'STUDENT',
      subject_ids: ids,
      issue_values,
    } as any);
  const snapshotValues = async (itemId: string) =>
    (
      await ds.query(`SELECT data_snapshot->'values' AS v FROM print_job_items WHERE id = $1`, [
        itemId,
      ])
    )[0].v as Record<string, string>;

  it('freezes the typed text in data_snapshot.values', async () => {
    const res = await create(boundTpl, [randomUUID()], { 'issue.conduct': CONDUCT });
    expect((await snapshotValues(res.items[0].item_id as string))['issue.conduct']).toBe(CONDUCT);
  });

  it('a reprint carries the same text, a new copy number and the same serial', async () => {
    const res = await create(boundTpl, [randomUUID()], { 'issue.conduct': CONDUCT });
    const first = res.items[0] as any;
    const again = await svc.reprint(caller(), res.job_id, [first.item_id]);
    const copy = again.items[0] as any;
    expect(copy.copy_number).toBe(2);
    expect(copy.serial_no).toBe(first.serial_no);
    expect((await snapshotValues(copy.item_id))['issue.conduct']).toBe(CONDUCT);
  });

  it('a bulk job of 3 stores the text on all 3', async () => {
    const res = await create(boundTpl, [randomUUID(), randomUUID(), randomUUID()], {
      'issue.conduct': CONDUCT,
    });
    expect(res.items).toHaveLength(3);
    for (const i of res.items) {
      expect((await snapshotValues(i.item_id as string))['issue.conduct']).toBe(CONDUCT);
    }
  });

  it('a template that binds no issue field refuses any issue_values key', async () => {
    await expect(create(plainTpl, [randomUUID()], { 'issue.conduct': 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM print_jobs WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(n).toBe(0);
  });

  it('a missing value on a template that places the field creates nothing', async () => {
    await expect(create(boundTpl, [randomUUID()])).rejects.toBeInstanceOf(BadRequestException);
  });
});
