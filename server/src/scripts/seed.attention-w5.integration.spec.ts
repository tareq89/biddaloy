import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  W5_HISTORY_COUNT,
  W5_MANUAL_DEDUPE,
  W5_MANUAL_TITLE,
  ensureAttentionW5Seed,
} from './seed.attention-w5';

// Real database (own throwaway school), so the SQL itself is exercised.
describe('ensureAttentionW5Seed', () => {
  let ds: DataSource;
  let tenantId: string;
  let adminId: string;
  let teacherId: string;
  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  beforeEach(async () => {
    [{ id: tenantId }] = await q(
      `INSERT INTO schools (name, slug) VALUES ('W5 Seed', $1) RETURNING id`,
      [`w5-seed-${Math.random().toString(36).slice(2, 9)}`],
    );
    const user = async (name: string, role: string) => {
      const [{ id }] = await q(
        `INSERT INTO users (email, password_hash, full_name, status) VALUES ($1, 'x', $2, 'ACTIVE') RETURNING id`,
        [`${name}-${tenantId}@example.com`, name],
      );
      await q(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [
        id,
        tenantId,
        role,
      ]);
      return id as string;
    };
    adminId = await user('admin', 'ADMIN');
    teacherId = await user('teacher', 'TEACHER');
    const [{ id: yearId }] = await q(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('Y', '2020-01-01', '2099-12-31', true, $1) RETURNING id`,
      [tenantId],
    );
    const [{ id: classId }] = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('7', $1, $2) RETURNING id`,
      [yearId, tenantId],
    );
    await q(`INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2)`, [
      classId,
      tenantId,
    ]);
  });

  const count = async (sql: string) => Number((await q(sql, [tenantId]))[0].n);
  const counts = async () => [
    await count(`SELECT count(*) n FROM alerts WHERE tenant_id = $1`),
    await count(`SELECT count(*) n FROM alert_recipients WHERE tenant_id = $1`),
  ];

  it('writes the manual alert, its teacher recipient and 40 history rows; a second run adds nothing', async () => {
    await ensureAttentionW5Seed(ds, tenantId, adminId);
    expect(await counts()).toEqual([W5_HISTORY_COUNT + 1, 1]);

    const [manual] = await q(`SELECT * FROM alerts WHERE tenant_id = $1 AND dedupe_key = $2`, [
      tenantId,
      W5_MANUAL_DEDUPE,
    ]);
    expect(manual).toMatchObject({ manual_title: W5_MANUAL_TITLE, created_by_user_id: adminId });
    const [recipient] = await q(`SELECT user_id, state FROM alert_recipients WHERE alert_id = $1`, [
      manual.id,
    ]);
    expect(recipient).toEqual({ user_id: teacherId, state: 'OPEN' });

    await ensureAttentionW5Seed(ds, tenantId, adminId); // idempotent
    expect(await counts()).toEqual([W5_HISTORY_COUNT + 1, 1]);
  });

  it('history sits in the previous month: 30 resolved, 10 expired, each with a section', async () => {
    await ensureAttentionW5Seed(ds, tenantId, adminId);
    const rows = await q(
      `SELECT status, params->>'sectionId' AS section,
              to_char(raised_at AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM')
                = to_char((now() AT TIME ZONE 'Asia/Dhaka') - interval '1 month', 'YYYY-MM') AS last_month
         FROM alerts WHERE tenant_id = $1 AND source = 'RULE'`,
      [tenantId],
    );
    expect(rows).toHaveLength(W5_HISTORY_COUNT);
    expect(rows.filter((r: { status: string }) => r.status === 'RESOLVED')).toHaveLength(30);
    expect(rows.filter((r: { status: string }) => r.status === 'EXPIRED')).toHaveLength(10);
    expect(rows.every((r: { section: string | null }) => r.section)).toBe(true);
    expect(rows.every((r: { last_month: boolean }) => r.last_month)).toBe(true);
  });

  it('leaves the 24-hour manual-send quota untouched (seeded rows are backdated)', async () => {
    await ensureAttentionW5Seed(ds, tenantId, adminId);
    const [{ n }] = await q(
      `SELECT count(*) n FROM alerts WHERE tenant_id = $1 AND source = 'MANUAL'
          AND raised_at > now() - interval '24 hours'`,
      [tenantId],
    );
    expect(Number(n)).toBe(0);
  });
});
