import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';
import { AlertWriterService } from '../engine/alert-writer.service';
import { AttentionScheduler } from '../engine/attention-scheduler';
import { RuleContextService } from './rule-context.service';
import { RuleRegistryService } from './rule-registry.service';

/**
 * [67.4.07] Guardian view of the FAMILY rules over HTTP: fees.due_soon,
 * exams.tomorrow and child.absent_today, labelled with the child's name, scoped
 * to the guardian's own school, and never shown to staff. No queue: the rules run
 * through the same three services the scheduler uses.
 */
const id = (n: number) => `00000000-0000-4000-8000-0000001e40${String(n).padStart(2, '0')}`;
const SCHOOL_A = id(1);
const SCHOOL_B = id(2);
const USERS = {
  G: { id: id(3), email: 'g@attn-w4.example', name: 'Guardian A' },
  ADMIN: { id: id(4), email: 'admin@attn-w4.example', name: 'Admin A' },
  G_B: { id: id(5), email: 'g-b@attn-w4.example', name: 'Guardian B' },
};
type Who = keyof typeof USERS;
// Monday 18:00 Asia/Dhaka.
const NOW = new Date('2026-10-12T12:00:00Z');
const TODAY = '2026-10-12';
const TOMORROW = '2026-10-13';
const FAMILY_RULES = ['fees.due_soon', 'exams.tomorrow', 'child.absent_today'] as const;

describe('Attention W4 E2E: family rules', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);

  const call = (path: string, who: Who, tenantId = SCHOOL_A) =>
    supertest(app.getHttpServer())
      .get(`/api/v1/attention${path}`)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .set('X-Tenant-ID', tenantId);

  async function runRules(tenantId: string) {
    const ctx = await app.get(RuleContextService).build(tenantId, NOW);
    for (const key of FAMILY_RULES) {
      const rule = app.get(RuleRegistryService).get(key)!;
      await app.get(AlertWriterService).apply(ctx, rule, await rule.evaluate(ctx));
    }
  }

  /** Two children in different classes (7-B and 8-A) of one school, one guardian for both. */
  async function mkSchool(tenantId: string, guardian: Who) {
    const [{ id: yearId }] = await q(
      `INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_current, created_at, updated_at)
       VALUES ($1, '2026', '2026-01-01', '2026-12-31', true, NOW(), NOW()) RETURNING id`,
      [tenantId],
    );
    const kid = async (klass: string, section: string, name: string, roll: number) => {
      const [{ id: classId }] = await q(
        `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, klass, yearId],
      );
      const [{ id: sectionId }] = await q(
        `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, classId, section],
      );
      const [{ id: studentId }] = await q(
        `INSERT INTO students (tenant_id, full_name, registration_number, roll_number, class_section_id, enrollment_status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE') RETURNING id`,
        [tenantId, name, `W4-${tenantId.slice(-2)}-${klass}`, roll, sectionId],
      );
      return {
        classId: classId as string,
        sectionId: sectionId as string,
        studentId: studentId as string,
      };
    };
    const c1 = await kid('7', 'B', 'Rahim', 1);
    const c2 = await kid('8', 'A', 'Karim', 1);
    const [{ id: guardianId }] = await q(
      `INSERT INTO guardians (tenant_id, full_name, relationship, user_id) VALUES ($1, 'Guardian', 'Father', $2) RETURNING id`,
      [tenantId, USERS[guardian].id],
    );
    for (const c of [c1, c2]) {
      await q(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
        c.studentId,
        guardianId,
      ]);
    }
    // C1: a 500 fee due in two days.
    const [{ id: structureId }] = await q(
      `INSERT INTO fee_structures (tenant_id, fee_type, name, amount, academic_year_id)
       VALUES ($1, 'OTHER', 'Fee', 500, $2) RETURNING id`,
      [tenantId, yearId],
    );
    await q(
      `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, period_type,
         total_amount, status, due_date)
       VALUES ($1, $2, $3, '2026-10-01', 'MONTH', 500, 'PENDING', '2026-10-14')`,
      [c1.studentId, yearId, structureId],
    );
    // C2's class: a fully scheduled exam tomorrow.
    const [{ id: subjectId }] = await q(
      `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, 'Math', 'গণিত', $2) RETURNING id`,
      [tenantId, `M-${tenantId.slice(-2)}`],
    );
    const [{ id: examId }] = await q(
      `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind, status)
       VALUES ($1, $2, $3, 'Mid Term', 'TERM', 'DRAFT') RETURNING id`,
      [tenantId, yearId, c2.classId],
    );
    await q(
      `INSERT INTO exam_components (tenant_id, exam_id, subject_id, name, kind, full_marks, sequence)
       VALUES ($1, $2, $3, 'Written', 'WRITTEN', 100, 1)`,
      [tenantId, examId, subjectId],
    );
    await q(
      `INSERT INTO exam_schedules (tenant_id, exam_id, subject_id, date, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, '10:00', '12:00')`,
      [tenantId, examId, subjectId, TOMORROW],
    );
    // C1: FINALIZED whole-day register today, absent.
    const [{ id: sessionId }] = await q(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, state) VALUES ($1, $2, $3, 'FINALIZED') RETURNING id`,
      [tenantId, c1.sectionId, TODAY],
    );
    await q(
      `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status) VALUES ($1, $2, $3, $4, 'ABSENT')`,
      [tenantId, sessionId, c1.studentId, TODAY],
    );
    return { c1: c1.studentId, c2: c2.studentId };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    // The app's own BullMQ sweeps run every rule at the real clock (CI: Saturday 09:08 Dhaka) and
    // can resolve or add alerts between runRules and a read. Only this file's runRules may write.
    await app.get(AttentionScheduler).worker.close();

    for (const [sid, slug] of [
      [SCHOOL_A, 'attn-w4-a'],
      [SCHOOL_B, 'attn-w4-b'],
    ]) {
      await q(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, $2, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [sid, slug],
      );
    }
    const members: [Who, string, UserRole][] = [
      ['G', SCHOOL_A, UserRole.PARENT],
      ['ADMIN', SCHOOL_A, UserRole.ADMIN],
      ['G_B', SCHOOL_B, UserRole.PARENT],
    ];
    for (const u of Object.values(USERS)) {
      await q(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, u.email, SEED_ADMIN_PASSWORD_HASH, u.name],
      );
    }
    for (const [who, school, role] of members) {
      await q(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [USERS[who].id, school, role],
      );
    }
    for (const [who, u] of Object.entries(USERS)) {
      tokens[who] = (
        await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: u.email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token;
    }
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  let A: { c1: string; c2: string };
  beforeEach(async () => {
    const schools = [SCHOOL_A, SCHOOL_B];
    // student_fees / student_guardians have no tenant_id: they go with their students.
    for (const table of ['student_fees', 'student_guardians']) {
      await q(
        `DELETE FROM ${table} WHERE student_id IN (SELECT id FROM students WHERE tenant_id = ANY($1))`,
        [schools],
      );
    }
    // The harness does not wipe classes or academic years, so clear both schools' fixtures (children first).
    for (const table of [
      'alert_recipients',
      'alerts',
      'attendance_records',
      'attendance_sessions',
      'exam_schedules',
      'exam_components',
      'exams',
      'fee_structures',
      'guardians',
      'subjects',
      'students',
      'class_sections',
      'classes',
      'academic_years',
    ]) {
      await q(`DELETE FROM ${table} WHERE tenant_id = ANY($1)`, [schools]);
    }
    A = await mkSchool(SCHOOL_A, 'G');
    await mkSchool(SCHOOL_B, 'G_B');
  });

  const runBoth = async () => {
    await runRules(SCHOOL_A);
    await runRules(SCHOOL_B);
  };

  it('shows the guardian one FAMILY item per rule, labelled with the right child', async () => {
    await runBoth();
    const { items } = (await call('/items?tab=active&role=PARENT&locale=en', 'G').expect(200)).body;
    expect(items).toHaveLength(3);
    expect(items.every((i: { category: string }) => i.category === 'FAMILY')).toBe(true);
    const by = (key: string) => items.find((i: { ruleKey: string }) => i.ruleKey === key);
    expect(by('fees.due_soon')).toMatchObject({
      studentName: 'Rahim',
      actionUrl: `/portal/fees?student=${A.c1}`,
    });
    expect(by('child.absent_today')).toMatchObject({
      studentName: 'Rahim',
      actionUrl: `/portal/attendance?student=${A.c1}`,
    });
    expect(by('exams.tomorrow')).toMatchObject({
      studentName: 'Karim',
      actionUrl: `/portal/exam-schedule?student=${A.c2}`,
    });

    const narrowed = (
      await call(`/items?tab=active&role=PARENT&studentId=${A.c1}&locale=en`, 'G').expect(200)
    ).body.items;
    expect(narrowed.map((i: { ruleKey: string }) => i.ruleKey).sort()).toEqual([
      'child.absent_today',
      'fees.due_soon',
    ]);
  });

  it('keeps schools apart and hides FAMILY items from staff', async () => {
    await runBoth();
    // G is not a member of school B: the tenant guard answers 401.
    await call('/items?tab=active&role=PARENT', 'G', SCHOOL_B).expect(401);

    const b = (await call('/items?tab=active&role=PARENT&locale=en', 'G_B', SCHOOL_B).expect(200))
      .body.items;
    expect(b).toHaveLength(3);
    const aIds = (await call('/items?tab=active&role=PARENT', 'G').expect(200)).body.items.map(
      (i: { alertId: string }) => i.alertId,
    );
    expect(b.some((i: { alertId: string }) => aIds.includes(i.alertId))).toBe(false);

    // Staff may get their own rules' alerts, but never a FAMILY one.
    for (const tab of ['active', 'history']) {
      const items = (await call(`/items?tab=${tab}&role=ADMIN`, 'ADMIN').expect(200)).body.items;
      expect(items.filter((i: { category: string }) => i.category === 'FAMILY')).toEqual([]);
    }
  });
});
