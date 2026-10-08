import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { DocumentKind } from '@biddaloy/shared';
import { ResultCertificateResolver } from './result-certificate.resolver';

describe('ResultCertificateResolver (integration)', () => {
  let ds: DataSource;
  const result = new ResultCertificateResolver(DocumentKind.RESULT_CERTIFICATE);
  const merit = new ResultCertificateResolver(DocumentKind.MERIT_CERTIFICATE);

  let tenantId: string;
  let cls: string;
  let sectionA: string;
  let sectionB: string;
  let examId: string;
  let studentId: string;
  let resultId: string;

  const q = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
  const resolve = (r = result, tenant = tenantId) =>
    r.resolve(tenant, [studentId], ds.manager, undefined, { type: 'EXAM', id: examId });
  const newTenant = () =>
    q(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `RC ${randomUUID()}`,
      `rc-${randomUUID()}`,
    ]);

  beforeAll(async () => {
    ds = (await createTestModule(ALL_ENTITIES, [])).get(DataSource);
  });
  afterAll(async () => {
    await ds.destroy();
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    tenantId = await newTenant();
    const year = await q(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id)
       VALUES ('2027', '2027-01-01', '2027-12-31', $1) RETURNING id`,
      [tenantId],
    );
    cls = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Class 8', $1, $2) RETURNING id`,
      [year, tenantId],
    );
    const sec = (name: string) =>
      q(
        `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, $2, $3) RETURNING id`,
        [cls, name, tenantId],
      );
    sectionA = await sec('A');
    sectionB = await sec('B');
    examId = await q(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'Half-Yearly', 'TERM', 'PUBLISHED', $3, NOW(), NOW()) RETURNING id`,
      [year, cls, tenantId],
    );
    studentId = await q(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ('Rahim', $1, 1, $2, $3) RETURNING id`,
      [`R-${randomUUID()}`, sectionA, tenantId],
    );
    const scale = await q(
      `INSERT INTO grading_scales (tenant_id, academic_year_id, name) VALUES ($1, $2, 'NCTB') RETURNING id`,
      [tenantId, year],
    );
    resultId = await q(
      `INSERT INTO results (tenant_id, exam_id, student_id, total_marks, gpa, grade, position,
                            section_id, section_position, is_fail, grading_scale_id,
                            grading_scale_revision, rule_version, computed_at, published_at)
       VALUES ($1, $2, $3, 812, 4.75, 'A', 3, $4, 2, false, $5, 1, 'v1', NOW(), NOW()) RETURNING id`,
      [tenantId, examId, studentId, sectionA, scale],
    );
  });

  it('resolves GPA and grade as stored, section from the result', async () => {
    const v = (await resolve()).get(studentId)!.values;
    expect(v['result.gpa']).toBe('4.75');
    expect(v['result.grade']).toBe('A');
    expect(v['result.total_marks']).toBe('812.00');
    expect(v['exam.year']).toBe('2027');
    expect(v['student.section']).toBe('A');
    expect((await resolve(merit)).get(studentId)!.values['result.section_position']).toBe('2');
  });

  it('refuses once the result is unpublished (exam reopened)', async () => {
    await ds.query(`UPDATE results SET published_at = NULL WHERE id = $1`, [resultId]);
    const e: any = await resolve().catch((x) => x);
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse().details.students).toEqual([{ id: studentId, reason: 'NOT_PUBLISHED' }]);
  });

  it('404s an exam of another tenant', async () => {
    const other = await newTenant();
    await expect(resolve(result, other)).rejects.toMatchObject({ status: 404 });
  });

  it('shows the section the exam was sat in after the student moves', async () => {
    await ds.query(`UPDATE students SET class_section_id = $1 WHERE id = $2`, [
      sectionB,
      studentId,
    ]);
    expect((await resolve()).get(studentId)!.values['student.section']).toBe('A');
  });
});
