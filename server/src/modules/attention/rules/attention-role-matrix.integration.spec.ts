import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  ALERT_RULES,
  AlertCategory,
  UserRole,
  alertRuleMeta,
  type AlertRuleKey,
} from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { AlertWriterService } from '../engine/alert-writer.service';
import { AttentionQueryService } from '../api/attention-query.service';
import { RuleContextService } from './rule-context.service';
import { RuleRegistryService } from './rule-registry.service';

/**
 * [67.4.07] Role matrix over the whole rule catalogue: run every registered rule
 * against one school that has a user per role and data for most rules, then check
 * that no role ever receives a rule that is not meant for it. Each check is its own
 * `it` that collects violations (no generated tests).
 */
const rand = () => Math.random().toString(36).slice(2, 9);
// Monday 11:00 Asia/Dhaka, a working day, inside the 2026 academic year.
const NOW = new Date('2026-10-12T05:00:00Z');
const TODAY = '2026-10-12';
const TOMORROW = '2026-10-13';
const ROLES = Object.values(UserRole);
const PERSONAL_RULES: string[] = ['leave.my_request_decided', 'acr.incomplete'];
// Rules this fixture must make fire, or the "no violations" checks would pass on nothing.
const MUST_FIRE: AlertRuleKey[] = [
  'attendance.not_taken',
  'fees.due_soon',
  'fees.overdue_family',
  'exams.tomorrow',
  'child.absent_today',
  'leave.staff_pending',
  'admission.applications_pending',
];

describe('Attention role matrix (integration)', () => {
  let ds: DataSource;
  let registry: RuleRegistryService;
  let query: AttentionQueryService;
  let context: RuleContextService;
  let writer: AlertWriterService;
  let tenantId: string;
  let platformTenantId: string | undefined;
  const users = {} as Record<UserRole, string>;
  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);

  async function seedSchool() {
    [{ id: tenantId }] = await q(
      `INSERT INTO schools (name, slug) VALUES ('Role Matrix', $1) RETURNING id`,
      [`role-matrix-${rand()}`],
    );
    for (const role of ROLES) {
      const [{ id }] = await q(
        `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, 'x', $2, 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [`matrix-${role.toLowerCase()}-${rand()}@example.com`, `Matrix ${role}`],
      );
      await q(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [id, tenantId, role],
      );
      users[role] = id;
    }
    const [{ id: yearId }] = await q(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('2026', '2026-01-01', '2026-12-31', true, $1) RETURNING id`,
      [tenantId],
    );
    const klass = async (name: string, section: string) => {
      const [{ id: classId }] = await q(
        `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ($1, $2, $3) RETURNING id`,
        [name, yearId, tenantId],
      );
      const [{ id: sectionId }] = await q(
        `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, $2, $3) RETURNING id`,
        [classId, section, tenantId],
      );
      return { classId: classId as string, sectionId: sectionId as string };
    };
    const student = async (name: string, sectionId: string, userId: string | null) =>
      (
        await q(
          `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, user_id)
           VALUES ($1, $2, 1, $3, $4, 'ACTIVE', $5) RETURNING id`,
          [name, `RM-${rand()}`, sectionId, tenantId, userId],
        )
      )[0].id as string;
    const c7 = await klass('7', 'B');
    const c8 = await klass('8', 'A');
    const rahim = await student('Rahim', c7.sectionId, users[UserRole.STUDENT]);
    const karim = await student('Karim', c8.sectionId, null);
    const [{ id: guardianId }] = await q(
      `INSERT INTO guardians (full_name, relationship, user_id, tenant_id) VALUES ('Parent', 'Father', $1, $2) RETURNING id`,
      [users[UserRole.PARENT], tenantId],
    );
    for (const s of [rahim, karim]) {
      await q(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
        s,
        guardianId,
      ]);
    }

    // Class teacher of 7-B with a Monday period and no register: attendance.not_taken.
    const [{ id: profileId }] = await q(
      `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'RM-T', NOW(), NOW()) RETURNING id`,
      [users[UserRole.TEACHER], tenantId],
    );
    const [{ id: teacherId }] = await q(
      `INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'RM-T', '{}', $2, $3, NOW(), NOW()) RETURNING id`,
      [users[UserRole.TEACHER], tenantId, profileId],
    );
    await q(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, assignment_type, tenant_id)
       VALUES ($1, $2, 'CLASS_TEACHER', $3)`,
      [teacherId, c7.sectionId, tenantId],
    );
    const [{ id: subjectId }] = await q(
      `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, 'Math', 'গণিত', $2) RETURNING id`,
      [tenantId, `RM-${rand()}`],
    );
    const [{ id: routineId }] = await q(
      `INSERT INTO routines (tenant_id, academic_year_id, name, state, published_at)
       VALUES ($1, $2, 'R', 'PUBLISHED', NOW()) RETURNING id`,
      [tenantId, yearId],
    );
    const [{ id: shiftId }] = await q(
      `INSERT INTO shifts (tenant_id, name, day_starts_at, day_ends_at, sequence)
       VALUES ($1, 'Day', '08:00', '14:00', 0) RETURNING id`,
      [tenantId],
    );
    const [{ id: periodId }] = await q(
      `INSERT INTO period_slots (tenant_id, shift_id, sequence, kind, starts_at, ends_at)
       VALUES ($1, $2, 1, 'CLASS', '08:00', '08:40') RETURNING id`,
      [tenantId, shiftId],
    );
    await q(
      `INSERT INTO routine_slots (tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id,
         recurrence, recurrence_offset, valid_from)
       VALUES ($1, $2, $3, $4, 1, $5, 'WEEKLY', 0, '2026-01-01')`,
      [tenantId, routineId, c7.sectionId, periodId, subjectId],
    );

    // Fees: Rahim due in 2 days, Karim overdue.
    const [{ id: structureId }] = await q(
      `INSERT INTO fee_structures (fee_type, name, amount, academic_year_id, tenant_id)
       VALUES ('MONTHLY_TUITION', 'Tuition', 500, $1, $2) RETURNING id`,
      [yearId, tenantId],
    );
    for (const [studentId, due, start] of [
      [rahim, '2026-10-14', '2026-10-01'],
      [karim, '2026-09-05', '2026-09-01'],
    ]) {
      await q(
        `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, period_type,
           total_amount, status, due_date)
         VALUES ($1, $2, $3, $4, 'MONTH', 500, 'PENDING', $5)`,
        [studentId, yearId, structureId, start, due],
      );
    }
    // Exam tomorrow for Rahim's class, fully scheduled.
    const [{ id: examId }] = await q(
      `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind, status)
       VALUES ($1, $2, $3, 'Mid Term', 'TERM', 'DRAFT') RETURNING id`,
      [tenantId, yearId, c7.classId],
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
    // Karim absent in 8-A's finalized register today.
    const [{ id: sessionId }] = await q(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, state) VALUES ($1, $2, $3, 'FINALIZED') RETURNING id`,
      [tenantId, c8.sectionId, TODAY],
    );
    await q(
      `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status) VALUES ($1, $2, $3, $4, 'ABSENT')`,
      [tenantId, sessionId, karim, TODAY],
    );
    // Office: a pending staff leave and a PENDING applicant.
    await q(
      `INSERT INTO leave_records (id, tenant_id, staff_profile_id, leave_type, start_date, end_date, days, status)
       VALUES (gen_random_uuid(), $1, $2, 'CASUAL', '2026-10-20', '2026-10-21', 2, 'PENDING')`,
      [tenantId, profileId],
    );
    const [{ id: intakeId }] = await q(
      `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date, close_date)
       VALUES ($1, $2, 'Intake', 30, '2026-10-01', '2026-10-30') RETURNING id`,
      [tenantId, c7.sectionId],
    );
    await q(
      `INSERT INTO admission_applicants (tenant_id, intake_id, reference_number, applicant_name,
         date_of_birth, gender, guardian_name, guardian_phone, status)
       VALUES ($1, $2, $3, 'Kid', '2035-01-01', 'MALE', 'Parent', '01700000009', 'PENDING')`,
      [tenantId, intakeId, `REF-${rand()}`],
    );
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();
    ds = app.get(DataSource);
    registry = app.get(RuleRegistryService);
    query = app.get(AttentionQueryService);
    context = app.get(RuleContextService);
    writer = app.get(AlertWriterService);
  }, 120_000);

  afterAll(async () => {
    await ds?.destroy();
  });

  // The harness wipes alerts, students and fees before every test, so each test builds the
  // school and runs the whole registry itself.
  async function prepare() {
    await seedSchool();
    // The platform tenant too, so platform.* rules (SUPER_ADMIN only) are exercised.
    platformTenantId = (await q(`SELECT id FROM schools WHERE slug = 'default-school'`))[0]?.id;
    for (const tid of [tenantId, platformTenantId].filter(Boolean) as string[]) {
      const ctx = await context.build(tid, NOW);
      for (const rule of registry.all()) {
        await writer.apply(ctx, rule, await rule.evaluate(ctx));
      }
    }
  }

  const rows = async (): Promise<{ rule_key: string; role: UserRole | null }[]> =>
    q(
      `SELECT a.rule_key, r.role FROM alert_recipients r JOIN alerts a ON a.id = r.alert_id
       WHERE a.tenant_id = ANY($1) AND a.source = 'RULE'`,
      [[tenantId, platformTenantId].filter(Boolean)],
    );

  it('every v1 rule in the catalogue has a registered rule class', () => {
    const missing = ALERT_RULES.filter(
      (r) => !r.ownerEpic && r.key !== 'manual.alert' && !registry.get(r.key),
    ).map((r) => r.key);
    expect(missing).toEqual([]);
  });

  it('the fixture makes the headline rules of every module fire', async () => {
    await prepare();
    const fired = new Set((await rows()).map((r) => r.rule_key));
    expect(MUST_FIRE.filter((k) => !fired.has(k))).toEqual([]);
  });

  it('every recipient row has a role the rule is meant for', async () => {
    await prepare();
    const violations = (await rows())
      .filter(
        (r) => r.role !== null && !alertRuleMeta(r.rule_key as AlertRuleKey).roles.includes(r.role),
      )
      .map((r) => `${r.rule_key} -> ${r.role}`);
    expect(violations).toEqual([]);
  });

  it("every recipient's stamped role is that user's real role in the alert's school", async () => {
    // The role on a row is whatever the rule wrote, so check it against the membership:
    // a family rule that sent to the ADMIN user while stamping PARENT fails here.
    await prepare();
    const violations = await q(
      `SELECT a.rule_key, r.role, r.user_id FROM alert_recipients r JOIN alerts a ON a.id = r.alert_id
       WHERE a.tenant_id = ANY($1) AND a.source = 'RULE'
         AND NOT EXISTS (SELECT 1 FROM user_tenants ut
                         WHERE ut.user_id = r.user_id AND ut.tenant_id = a.tenant_id AND ut.deleted_at IS NULL
                           AND (r.role IS NULL OR ut.role::text = r.role))`,
      [[tenantId, platformTenantId].filter(Boolean)],
    );
    expect(violations).toEqual([]);
  });

  it('role-less (personal) rows only come from personal rules', async () => {
    await prepare();
    const violations = (await rows())
      .filter((r) => r.role === null && !PERSONAL_RULES.includes(r.rule_key))
      .map((r) => r.rule_key);
    expect(violations).toEqual([]);
  });

  it("each role's summary and items only show its own rules", async () => {
    await prepare();
    const violations: string[] = [];
    for (const role of ROLES) {
      const userId = users[role];
      await query.summary(tenantId, userId, role, {} as never);
      const { items } = await query.items(tenantId, userId, role, {
        tab: 'active',
        page: 1,
        pageSize: 100,
      } as never);
      for (const item of items) {
        const meta = alertRuleMeta(item.ruleKey as AlertRuleKey);
        if (!PERSONAL_RULES.includes(item.ruleKey) && !meta.roles.includes(role)) {
          violations.push(`${role} sees ${item.ruleKey}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('SUPER_ADMIN of a normal school gets nothing, and no platform alert lands in a school', async () => {
    await prepare();
    const toSuperAdmin = await q(
      `SELECT a.rule_key FROM alert_recipients r JOIN alerts a ON a.id = r.alert_id
       WHERE a.tenant_id = $1 AND a.source = 'RULE' AND r.role = 'SUPER_ADMIN'`,
      [tenantId],
    );
    expect(toSuperAdmin).toEqual([]);
    // Platform rules belong to the platform tenant only, whoever they would address.
    const platformKeys = ALERT_RULES.filter((r) => r.category === AlertCategory.PLATFORM).map(
      (r) => r.key,
    );
    const platformInSchool = await q(
      `SELECT rule_key FROM alerts WHERE tenant_id = $1 AND rule_key = ANY($2)`,
      [tenantId, platformKeys],
    );
    expect(platformInSchool).toEqual([]);
  });
});
