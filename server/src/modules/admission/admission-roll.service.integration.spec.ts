import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AdmissionRollService } from './admission-roll.service';

/** [71.G1.04] Real row lock: parallel assigns never share a roll number. */
describe('AdmissionRollService (integration)', () => {
  let ds: DataSource;
  let service: AdmissionRollService;
  let tenant: string;
  let intake: string;
  let n = 0;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    service = new AdmissionRollService(ds, { notifyStageSchedule: async () => undefined } as never);
  }, 60000);

  beforeEach(async () => {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), 'Roll Int', 'roll-int-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
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
      `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date, close_date, roll_prefix)
       VALUES ($1, $2, 'i', 50, '2026-01-01', '2026-12-31', 'R-') RETURNING id`,
      [id, s.id],
    );
    intake = i.id;
  });

  afterEach(async () => {
    for (const t of [
      'admission_applicants',
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

  async function applicant(name: string, status: string, createdAt = 'now()') {
    n += 1;
    await ds.query(
      `INSERT INTO admission_applicants
         (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
          guardian_name, guardian_phone, status, created_at)
       VALUES ($1, $2, $3, $4, '2015-01-01', 'M', 'G', '01700000000', $5, ${createdAt})`,
      [tenant, intake, `ADM-R-${n}`, name, status],
    );
  }
  const rolls = async () =>
    (
      await ds.query(
        `SELECT applicant_name AS name, roll_number AS roll FROM admission_applicants WHERE intake_id = $1 ORDER BY roll_number NULLS LAST`,
        [intake],
      )
    ).map((r: { name: string; roll: string | null }) => [r.name, r.roll]);

  it('orders by time or by name, skips FEE_PENDING, and a repeat numbers only the new', async () => {
    await applicant('Zed', 'PENDING', `now() - interval '2 hours'`);
    await applicant('Amy', 'SHORTLISTED', `now() - interval '1 hour'`);
    await applicant('Fee', 'FEE_PENDING');
    await service.assign(intake, 'APPLIED_AT', tenant);
    expect(await rolls()).toEqual([
      ['Zed', 'R-0001'],
      ['Amy', 'R-0002'],
      ['Fee', null],
    ]);

    await applicant('Bob', 'PENDING');
    const again = await service.assign(intake, 'NAME', tenant);
    expect(again).toMatchObject({ assigned: 1, first_roll: 'R-0003' });
    expect((await service.assign(intake, 'NAME', tenant)).assigned).toBe(0);
  });

  it('by name numbers in alphabetical order', async () => {
    await applicant('Zed', 'PENDING');
    await applicant('Amy', 'PENDING');
    await service.assign(intake, 'NAME', tenant);
    expect(await rolls()).toEqual([
      ['Amy', 'R-0001'],
      ['Zed', 'R-0002'],
    ]);
  });

  it('parallel calls never share a roll', async () => {
    for (let i = 0; i < 6; i += 1) await applicant(`P${i}`, 'PENDING');
    await Promise.all([
      service.assign(intake, 'NAME', tenant),
      service.assign(intake, 'NAME', tenant),
      service.assign(intake, 'APPLIED_AT', tenant),
    ]);
    const all = (await rolls()).map((r: [string, string]) => r[1]);
    expect(new Set(all).size).toBe(6);
    expect(all).not.toContain(null);
    const [row] = await ds.query(`SELECT roll_counter FROM admission_intakes WHERE id = $1`, [
      intake,
    ]);
    expect(row.roll_counter).toBe(6);
  });
});
