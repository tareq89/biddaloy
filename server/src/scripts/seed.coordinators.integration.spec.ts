import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { Teacher } from '../modules/academics/entities/teacher.entity';
import { ensureCoordinatorsSeed } from './seed.coordinators';
import { ASSISTANT_TEACHER_EMAIL, DEMO_ACADEMIC_YEAR } from './seed.util';

/**
 * [83.3.4] D31: the dev seed's class coordinator (teacher@, Class 6 + 7) and Mathematics subject
 * coordinator (assistant-teacher@, Class 6). Runs twice to prove it is idempotent. Uses its own
 * school so the shared seed school is never touched.
 */
describe('ensureCoordinatorsSeed (integration)', () => {
  let ds: DataSource;
  let tenantId: string;
  const rand = () => Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('adds three rows once, then none', async () => {
    [{ id: tenantId }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Coord Seed', $1) RETURNING id`,
      [`coord-seed-${rand()}`],
    );
    const [{ id: yearId }] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ($1, '2026-01-01', '2026-12-31', true, $2) RETURNING id`,
      [DEMO_ACADEMIC_YEAR.name, tenantId],
    );
    for (const name of ['Class 6', 'Class 7', 'Class 8']) {
      await ds.query(
        `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, $2, $3)`,
        [tenantId, name, yearId],
      );
    }
    await ds.query(
      `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, 'Mathematics', 'MATH')`,
      [tenantId],
    );
    for (const email of ['teacher@biddaloy.test', ASSISTANT_TEACHER_EMAIL]) {
      const [existing] = await ds.query(`SELECT id FROM users WHERE email = $1`, [email]);
      const userId =
        existing?.id ??
        (
          await ds.query(
            `INSERT INTO users (email, full_name, status) VALUES ($1, 'Seed', 'ACTIVE') RETURNING id`,
            [email],
          )
        )[0].id;
      await ds.getRepository(Teacher).save({
        user_id: userId,
        employee_id: `EMP-CS-${rand()}`,
        tenant_id: tenantId,
        designations: [],
      });
    }

    expect(await ensureCoordinatorsSeed(ds, tenantId)).toBe(3);
    expect(await ensureCoordinatorsSeed(ds, tenantId)).toBe(0);
    const rows = await ds.query(
      `SELECT c.name, s.code FROM coordinator_assignments ca
         JOIN classes c ON c.id = ca.class_id LEFT JOIN subjects s ON s.id = ca.subject_id
        WHERE ca.tenant_id = $1 ORDER BY c.name, s.code NULLS FIRST`,
      [tenantId],
    );
    expect(rows).toEqual([
      { name: 'Class 6', code: null },
      { name: 'Class 6', code: 'MATH' },
      { name: 'Class 7', code: null },
    ]);
  });
});
