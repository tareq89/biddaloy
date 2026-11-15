import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AdmissionStage } from './entities/admission-stage.entity';
import { AdmissionStageService } from './admission-stage.service';
import { AdmissionStageResultService } from './admission-stage-result.service';

const actor = { userId: '00000000-0000-4000-8000-000000000001' };

/** [71.G2.05] Real DB: the round lock makes result writes and stage delete / kind change atomic. */
describe('AdmissionStageResultService (integration)', () => {
  let ds: DataSource;
  let stages: AdmissionStageService;
  let results: AdmissionStageResultService;
  let tenant: string;
  let intake: string;
  let stage: string;
  let n = 0;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    stages = new AdmissionStageService(ds.getRepository(AdmissionStage), ds);
    results = new AdmissionStageResultService(ds, stages, {
      record: async () => undefined,
    } as never);
  }, 60000);

  beforeEach(async () => {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), 'Res Int', 'res-int-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
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
    intake = i.id;
    const [st] = await ds.query(
      `INSERT INTO admission_stages (tenant_id, intake_id, position, kind, config)
       VALUES ($1, $2, 1, 'WRITTEN', '{"total_marks": 100}') RETURNING id`,
      [id, intake],
    );
    stage = st.id;
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

  async function applicant(status = 'PENDING'): Promise<string> {
    n += 1;
    const [{ id }] = await ds.query(
      `INSERT INTO admission_applicants
         (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
          guardian_name, guardian_phone, status)
       VALUES ($1, $2, $3, $4, '2015-01-01', 'M', 'G', '01700000000', $5) RETURNING id`,
      [tenant, intake, `ADM-RS-${n}`, `Child ${n}`, status],
    );
    return id;
  }
  const put = (id: string, score = 50) =>
    results.putResults(
      stage,
      { results: [{ applicant_id: id, attended: true, score }] } as never,
      tenant,
      actor,
    );

  it('FEE_PENDING applicants are never in a stage', async () => {
    const pending = await applicant('FEE_PENDING');
    await expect(put(pending)).rejects.toThrow();
    const ok = await applicant();
    await expect(put(ok)).resolves.toEqual({ saved: 1 });
  });

  it('a later stage lists only those who passed the earlier one', async () => {
    const a = await applicant();
    const b = await applicant();
    await results.putResults(
      stage,
      {
        results: [a, b].map((id, k) => ({ applicant_id: id, attended: true, score: 90 - k })),
      } as never,
      tenant,
      actor,
    );
    await results.commit(stage, { mode: 'TOP_N', value: 1 } as never, tenant, actor);
    const [{ id: next }] = await ds.query(
      `INSERT INTO admission_stages (tenant_id, intake_id, position, kind, config)
       VALUES ($1, $2, 2, 'VIVA', '{"total_marks": 20}') RETURNING id`,
      [tenant, intake],
    );
    const put2 = (id: string) =>
      results.putResults(
        next,
        { results: [{ applicant_id: id, attended: true, score: 5 }] } as never,
        tenant,
        actor,
      );
    await expect(put2(a)).resolves.toEqual({ saved: 1 });
    await expect(put2(b)).rejects.toThrow();
  });

  it('delete and kind change are refused once results exist', async () => {
    await put(await applicant());
    await expect(stages.remove(intake, stage, tenant)).rejects.toMatchObject({ status: 409 });
    await expect(
      stages.update(intake, stage, { kind: 'VIVA' } as never, tenant),
    ).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      stages.update(intake, stage, { title: 'same kind ok' } as never, tenant),
    ).resolves.toBeDefined();
  });

  it('parallel result write and stage delete never leave a result on a deleted stage', async () => {
    for (let round = 0; round < 5; round++) {
      const [{ id: st }] = await ds.query(
        `INSERT INTO admission_stages (tenant_id, intake_id, position, kind, config)
         VALUES ($1, $2, $3, 'WRITTEN', '{"total_marks": 100}') RETURNING id`,
        [tenant, intake, 10 + round],
      );
      const id = await applicant();
      const settled = await Promise.allSettled([
        stages.remove(intake, st, tenant),
        results.putResults(
          st,
          { results: [{ applicant_id: id, attended: true, score: 1 }] } as never,
          tenant,
          actor,
        ),
      ]);
      const [{ deleted }] = await ds.query(
        `SELECT deleted_at IS NOT NULL AS deleted FROM admission_stages WHERE id = $1`,
        [st],
      );
      const [{ count }] = await ds.query(
        `SELECT count(*)::int AS count FROM admission_stage_results WHERE stage_id = $1`,
        [st],
      );
      expect(deleted && count > 0).toBe(false);
      // Exactly one side won.
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    }
  });
});
