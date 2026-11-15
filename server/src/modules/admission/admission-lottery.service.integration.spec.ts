import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AdmissionStage } from './entities/admission-stage.entity';
import { AdmissionStageService } from './admission-stage.service';
import { AdmissionStageResultService } from './admission-stage-result.service';
import { AdmissionLotteryService } from './admission-lottery.service';

const actor = { userId: '00000000-0000-4000-8000-000000000001' };

/** [71.G2.06] Real DB: two parallel draws, exactly one wins; the loser is 409. */
describe('AdmissionLotteryService (integration)', () => {
  let ds: DataSource;
  let lottery: AdmissionLotteryService;
  let tenant: string;
  let stage: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    const audit = { record: async () => undefined } as never;
    const stages = new AdmissionStageService(ds.getRepository(AdmissionStage), ds);
    lottery = new AdmissionLotteryService(
      ds,
      new AdmissionStageResultService(ds, stages, audit),
      {} as never,
      audit,
    );
  }, 60000);

  beforeEach(async () => {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), 'Lot Int', 'lot-int-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    tenant = id;
    const [yr] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id) VALUES ('y', '2026-01-01', '2026-12-31', false, $1) RETURNING id`,
      [id],
    );
    const [c] = await ds.query(
      `INSERT INTO classes (name, numeric_grade, academic_year_id, tenant_id) VALUES ('Six', 6, $1, $2) RETURNING id`,
      [yr.id, id],
    );
    const [s] = await ds.query(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [c.id, id],
    );
    const [i] = await ds.query(
      `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date, close_date)
       VALUES ($1, $2, 'i', 50, '2026-01-01', '2026-12-31') RETURNING id`,
      [id, s.id],
    );
    const [st] = await ds.query(
      `INSERT INTO admission_stages (tenant_id, intake_id, position, kind, config)
       VALUES ($1, $2, 1, 'LOTTERY', '{}') RETURNING id`,
      [id, i.id],
    );
    stage = st.id;
    for (let k = 0; k < 6; k++)
      await ds.query(
        `INSERT INTO admission_applicants
           (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
            guardian_name, guardian_phone, status)
         VALUES ($1, $2, $3::text, 'Kid ' || $3::text, '2015-01-01', 'MALE', 'G', '01711000097', 'PENDING')`,
        [id, i.id, `LOT-${k}`],
      );
  });

  afterEach(async () => {
    for (const t of [
      'admission_stage_results',
      'admission_applicants',
      'admission_stages',
      'admission_intakes',
      'class_sections',
      'classes',
      'academic_years',
    ])
      await ds.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenant]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenant]);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('two parallel draws: one succeeds, one is LOTTERY_ALREADY_DRAWN, 6 unique ranks', async () => {
    const settled = await Promise.allSettled([
      lottery.draw(stage, tenant, actor),
      lottery.draw(stage, tenant, actor),
    ]);
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason.getResponse().details.code).toBe('LOTTERY_ALREADY_DRAWN');
    const rows = await ds.query(
      `SELECT score::text AS score FROM admission_stage_results WHERE stage_id = $1`,
      [stage],
    );
    expect(rows.map((r: { score: string }) => r.score).sort()).toEqual([
      '1.00',
      '2.00',
      '3.00',
      '4.00',
      '5.00',
      '6.00',
    ]);
  });
});
