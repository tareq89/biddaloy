import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AdmissionFeeService } from './admission-fee.service';
import { AdmissionFeeProof } from './entities/admission-fee-proof.entity';

/** [71.G1.03] Real row locks: two staff confirming one proof at once confirm it once. */
describe('AdmissionFeeService (integration)', () => {
  let ds: DataSource;
  let service: AdmissionFeeService;
  let tenant: string;
  let intake: string;
  let audits: unknown[];
  let n = 0;
  const actor = { userId: null as unknown as string };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    audits = [];
    service = new AdmissionFeeService(
      module.get(getRepositoryToken(AdmissionFeeProof)),
      {} as never,
      { record: async (row: unknown) => void audits.push(row) } as never,
      { notifyFeeSentBack: async () => undefined } as never,
    );
  }, 60000);

  beforeEach(async () => {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), 'Fee Int', 'fee-int-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
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
  });

  afterEach(async () => {
    for (const t of [
      'admission_fee_proofs',
      'admission_applicants',
      'admission_intakes',
      'class_sections',
      'classes',
      'academic_years',
    ]) {
      await ds.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenant]);
    }
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenant]);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  async function proofRow(reference: string | null): Promise<{ proof: string; applicant: string }> {
    n += 1;
    const [a] = await ds.query(
      `INSERT INTO admission_applicants
         (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
          guardian_name, guardian_phone, status, fee_state)
       VALUES ($1, $2, $3, $4, '2015-01-01', 'M', 'G', '01700000000', 'FEE_PENDING', 'AWAITING') RETURNING id`,
      [tenant, intake, `ADM-F-${n}`, `Applicant ${n}`],
    );
    const [p] = await ds.query(
      `INSERT INTO admission_fee_proofs (tenant_id, applicant_id, attachment_key, method, reference)
       VALUES ($1, $2, 'k', 'BKASH', $3) RETURNING id`,
      [tenant, a.id, reference],
    );
    return { proof: p.id, applicant: a.id };
  }

  it('concurrent confirm confirms once; the loser gets 409', async () => {
    const { proof, applicant } = await proofRow(null);
    audits.length = 0;
    const results = await Promise.allSettled([
      service.confirm(proof, tenant, actor),
      service.confirm(proof, tenant, actor),
      service.confirm(proof, tenant, actor),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((r) => r.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    }
    expect(audits).toHaveLength(1);
    const [row] = await ds.query(
      `SELECT status, fee_state FROM admission_applicants WHERE id = $1`,
      [applicant],
    );
    expect(row).toEqual({ status: 'PENDING', fee_state: 'CONFIRMED' });
  });

  it('confirm racing send-back: exactly one decision wins', async () => {
    const { proof } = await proofRow(null);
    const results = await Promise.allSettled([
      service.confirm(proof, tenant, actor),
      service.sendBack(proof, tenant, 'bad', actor),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('list counts seen_before in one grouped pass and ignores a null reference', async () => {
    const a = await proofRow('TX-DUP');
    await proofRow('TX-DUP');
    const solo = await proofRow(null);
    const res = await service.list(tenant, { limit: 100 });
    const by = new Map(res.data.map((r) => [r.id, r.seen_before]));
    expect(by.get(a.proof)).toBe(1);
    expect(by.get(solo.proof)).toBe(0);
    expect(res.data.every((r) => r.state === 'AWAITING')).toBe(true);
  });

  it('[#4253] filters by applicant and carries the round fee in paisa', async () => {
    await ds.query(`UPDATE admission_intakes SET fee_amount_paisa = 25050 WHERE id = $1`, [intake]);
    const a = await proofRow('X1');
    await proofRow('X2');
    await ds.query(`UPDATE admission_fee_proofs SET state = 'CONFIRMED' WHERE id = $1`, [a.proof]);
    const res = await service.list(tenant, { applicantId: a.applicant, limit: 100 });
    expect(res.total).toBe(1);
    expect(res.data[0]).toMatchObject({ id: a.proof, amount_paisa: 25050, state: 'CONFIRMED' });
  });
});
