import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { localToday } from '../modules/attendance/attendance-policy.util';
import { FeesUnassignedStudentsRule } from '../modules/attention/rules/fees/fees-unassigned-students.rule';
import type { RuleContext } from '../modules/attention/rules/rule.types';
import {
  ATTENTION_DEMO_EXAM,
  ATTENTION_DEMO_FEE,
  ATTENTION_FAILED_LOGS,
  ATTENTION_PARENT_EMAIL,
  ATTENTION_HOMEWORK_TITLES,
  ATTENTION_TEACHER_EMAIL,
  ensureAttentionRulesSeed,
} from './seed.attention-rules';

describe('ensureAttentionRulesSeed (integration)', () => {
  let ds: DataSource;
  let tenantId: string;
  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    [{ id: tenantId }] = await q(
      `INSERT INTO schools (name, slug) VALUES ('Attn Seed', $1) RETURNING id`,
      [`attn-seed-${Math.random().toString(36).slice(2, 9)}`],
    );
  });

  /** The demo teacher, class teacher of section 7-A, whose class has one subject. */
  async function addTeacherWithSection() {
    await q(`DELETE FROM users WHERE email = $1`, [ATTENTION_TEACHER_EMAIL]);
    const [{ id: userId }] = await q(
      `INSERT INTO users (email, password_hash, full_name, status) VALUES ($1, 'x', 'T', 'ACTIVE') RETURNING id`,
      [ATTENTION_TEACHER_EMAIL],
    );
    const [{ id: yearId }] = await q(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('Y', '2020-01-01', '2099-12-31', true, $1) RETURNING id`,
      [tenantId],
    );
    const [{ id: classId }] = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('7', $1, $2) RETURNING id`,
      [yearId, tenantId],
    );
    const [{ id: sectionId }] = await q(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [classId, tenantId],
    );
    const [{ id: sp }] = await q(
      `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'SP-1', NOW(), NOW()) RETURNING id`,
      [userId, tenantId],
    );
    const [{ id: teacherId }] = await q(
      `INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'T-1', '{}', $2, $3, NOW(), NOW()) RETURNING id`,
      [userId, tenantId, sp],
    );
    await q(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, assignment_type, tenant_id)
       VALUES ($1, $2, 'CLASS_TEACHER', $3)`,
      [teacherId, sectionId, tenantId],
    );
    const [{ id: subjectId }] = await q(
      `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, 'Math', 'গণিত', 'M-1') RETURNING id`,
      [tenantId],
    );
    await q(
      `INSERT INTO class_subjects (tenant_id, class_id, subject_id, academic_year_id) VALUES ($1, $2, $3, $4)`,
      [tenantId, classId, subjectId, yearId],
    );
    return { classId, sectionId, yearId };
  }

  /** parent@biddaloy.test, guardian of one student in the given section. */
  async function addParentWithChild(sectionId: string) {
    await q(`DELETE FROM users WHERE email = $1`, [ATTENTION_PARENT_EMAIL]);
    const [{ id: userId }] = await q(
      `INSERT INTO users (email, password_hash, full_name, status) VALUES ($1, 'x', 'P', 'ACTIVE') RETURNING id`,
      [ATTENTION_PARENT_EMAIL],
    );
    const [{ id: studentId }] = await q(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status)
       VALUES ('Demo Child', 'REG-ATTN', 1, $1, $2, 'ACTIVE') RETURNING id`,
      [sectionId, tenantId],
    );
    const [{ id: guardianId }] = await q(
      `INSERT INTO guardians (full_name, relationship, user_id, tenant_id) VALUES ('P', 'Father', $1, $2) RETURNING id`,
      [userId, tenantId],
    );
    await q(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      studentId,
      guardianId,
    ]);
    return studentId as string;
  }

  const count = async (table: string, extra = '') =>
    (
      await q(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1 ${extra}`, [tenantId])
    )[0].n as number;
  const counts = async () => ({
    homework: await count('homework'),
    assignments: await count('homework_assignments'),
    failed: await count('communication_logs', `AND status = 'FAILED'`),
  });
  const dues = async (): Promise<string[]> =>
    (
      await q(
        `SELECT a.due_date::text AS due FROM homework_assignments a
         JOIN homework h ON h.id = a.homework_id WHERE a.tenant_id = $1 ORDER BY a.due_date`,
        [tenantId],
      )
    ).map((r: { due: string }) => r.due);
  const plusDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  it('is idempotent: running twice leaves 2 homework, 2 assignments and 10 FAILED logs', async () => {
    await addTeacherWithSection();
    await ensureAttentionRulesSeed(ds, tenantId);
    await ensureAttentionRulesSeed(ds, tenantId);

    expect(await counts()).toEqual({ homework: 2, assignments: 2, failed: ATTENTION_FAILED_LOGS });
    const titles = await q(`SELECT title FROM homework WHERE tenant_id = $1 ORDER BY title`, [
      tenantId,
    ]);
    expect(titles.map((r: { title: string }) => r.title)).toEqual(
      [...ATTENTION_HOMEWORK_TITLES].sort(),
    );
  });

  it('a re-seed on a later day moves both due dates to that day', async () => {
    await addTeacherWithSection();
    await ensureAttentionRulesSeed(ds, tenantId);
    const today = localToday('Asia/Dhaka');
    expect(await dues()).toEqual([today, plusDays(today, 1)]);

    vi.useFakeTimers({ toFake: ['Date'], now: new Date(Date.now() + 3 * 86_400_000) });
    await ensureAttentionRulesSeed(ds, tenantId);
    vi.useRealTimers();

    expect(await dues()).toEqual([plusDays(today, 3), plusDays(today, 4)]);
    expect((await counts()).homework).toBe(2);
  });

  it('warns and writes nothing when the demo teacher has no class-teacher section', async () => {
    await q(`DELETE FROM users WHERE email = $1`, [ATTENTION_TEACHER_EMAIL]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await ensureAttentionRulesSeed(ds, tenantId);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(ATTENTION_TEACHER_EMAIL));
    expect(await counts()).toEqual({ homework: 0, assignments: 0, failed: 0 });
    warn.mockRestore();
  });

  const family = async () => ({
    fees: (
      await q(
        `SELECT sf.due_date::text AS due FROM student_fees sf JOIN fee_structures fs ON fs.id = sf.fee_structure_id
         WHERE fs.tenant_id = $1 AND fs.name = $2`,
        [tenantId, ATTENTION_DEMO_FEE],
      )
    ).map((r: { due: string }) => r.due),
    exams: await count('exams', `AND name = '${ATTENTION_DEMO_EXAM}'`),
    components: await count('exam_components'),
    schedules: (
      await q(`SELECT date::text AS d FROM exam_schedules WHERE tenant_id = $1`, [tenantId])
    ).map((r: { d: string }) => r.d),
  });

  it('family block: second run leaves one demo fee, one exam + schedule; dates move with today', async () => {
    const { sectionId } = await addTeacherWithSection();
    await addParentWithChild(sectionId);
    await ensureAttentionRulesSeed(ds, tenantId);
    await ensureAttentionRulesSeed(ds, tenantId);

    const today = localToday('Asia/Dhaka');
    expect(await family()).toEqual({
      fees: [plusDays(today, 2)],
      exams: 1,
      components: 1,
      schedules: [plusDays(today, 1)],
    });

    vi.useFakeTimers({ toFake: ['Date'], now: new Date(Date.now() + 3 * 86_400_000) });
    await ensureAttentionRulesSeed(ds, tenantId);
    vi.useRealTimers();
    expect(await family()).toEqual({
      fees: [plusDays(today, 5)],
      exams: 1,
      components: 1,
      schedules: [plusDays(today, 4)],
    });
  });

  it('family block: the demo fee (type OTHER) does not raise fees.unassigned_students', async () => {
    const { sectionId } = await addTeacherWithSection();
    await addParentWithChild(sectionId);
    // A classmate without the demo fee, and an ADMIN who would receive the item.
    await q(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status)
       VALUES ('Classmate', 'REG-ATTN-2', 2, $1, $2, 'ACTIVE')`,
      [sectionId, tenantId],
    );
    const [{ id: adminId }] = await q(
      `INSERT INTO users (email, password_hash, full_name, status) VALUES ($1, 'x', 'A', 'ACTIVE') RETURNING id`,
      [`attn-seed-admin-${Math.random().toString(36).slice(2, 9)}@example.com`],
    );
    await q(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'ADMIN')`, [
      adminId,
      tenantId,
    ]);
    await ensureAttentionRulesSeed(ds, tenantId);

    const ctx = { tenantId, localDate: localToday('Asia/Dhaka') } as RuleContext;
    expect(await new FeesUnassignedStudentsRule(ds).evaluate(ctx)).toEqual([]);
  });

  it('missing parent warns and skips only the family block', async () => {
    await addTeacherWithSection();
    await q(`DELETE FROM users WHERE email = $1`, [ATTENTION_PARENT_EMAIL]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await ensureAttentionRulesSeed(ds, tenantId);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(ATTENTION_PARENT_EMAIL));
    expect((await counts()).homework).toBe(2);
    expect(await family()).toEqual({ fees: [], exams: 0, components: 0, schedules: [] });
    warn.mockRestore();
  });
});
