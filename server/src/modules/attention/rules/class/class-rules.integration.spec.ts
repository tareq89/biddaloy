import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AttendanceStatus, UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { AuthModule } from '../../../auth/auth.module';
import { AttendanceModule } from '../../../attendance/attendance.module';
import { AttendanceSummaryService } from '../../../attendance/attendance-summary.service';
import { TenantStatusModule } from '../../../schools/tenant-status.module';
import { DEFAULT_TENANT_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import { AlertWriterService } from '../../engine/alert-writer.service';
import type { AttentionRule, RuleContext } from '../rule.types';
import { ClassAbsentStreakRule } from './class-absent-streak.rule';
import { ClassGuardianContactMissingRule } from './class-guardian-contact-missing.rule';
import { ClassRulesModule } from './class-rules.module';

const NOW = new Date('2026-10-10T05:00:00Z');
const DAYS = ['2026-10-06', '2026-10-07', '2026-10-08']; // oldest .. newest

describe('Class rules (integration)', () => {
  let ds: DataSource;
  let writer: AlertWriterService;
  let streak: ClassAbsentStreakRule;
  let contact: ClassGuardianContactMissingRule;
  let summary: AttendanceSummaryService;
  let seq = 0;

  const ctx = (tenantId: string): RuleContext => ({
    tenantId,
    now: NOW,
    tz: 'Asia/Dhaka',
    localDate: '2026-10-10',
    localTime: '11:00',
    isWorkingDay: true,
    settings: { ...DEFAULT_TENANT_SETTINGS.attention! },
  });
  const one = async (sql: string, params: unknown[]) =>
    (await ds.query(sql, params))[0].id as string;
  const uniq = () => `${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 7)}`;

  const mkUser = (name: string) =>
    one(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', $2, 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`class-${uniq()}@example.com`, name],
    );
  const mkTeacher = async (tenantId: string, sectionId: string, type: string) => {
    const userId = await mkUser('Class Teacher');
    const sp = await one(
      `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING id`,
      [userId, tenantId, 'EMP-' + uniq()],
    );
    const teacherId = await one(
      `INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, '{}', $3, $4, NOW(), NOW()) RETURNING id`,
      [userId, 'T-' + uniq(), tenantId, sp],
    );
    await ds.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, assignment_type, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
      [teacherId, sectionId, tenantId, type],
    );
    return userId;
  };
  const mkStudent = (tenantId: string, sectionId: string, name: string) =>
    one(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $5, $3, $4, 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [name, 'REG-' + uniq(), sectionId, tenantId, ++seq],
    );
  const mkGuardian = async (tenantId: string, studentId: string, phone: string | null) => {
    const gid = await one(
      `INSERT INTO guardians (id, full_name, relationship, phone, tenant_id, created_at, updated_at)
       VALUES (gen_random_uuid(), 'Guardian', 'FATHER', $1, $2, NOW(), NOW()) RETURNING id`,
      [phone, tenantId],
    );
    await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      studentId,
      gid,
    ]);
  };
  const mark = async (
    tenantId: string,
    sectionId: string,
    date: string,
    marks: [string, AttendanceStatus][],
  ) => {
    const sid =
      (
        await ds.query(
          `SELECT id FROM attendance_sessions WHERE tenant_id=$1 AND section_id=$2 AND date=$3 AND period_no IS NULL`,
          [tenantId, sectionId, date],
        )
      )[0]?.id ??
      (await one(
        `INSERT INTO attendance_sessions (id, tenant_id, section_id, date, period_no, state, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NULL, 'FINALIZED', NOW(), NOW()) RETURNING id`,
        [tenantId, sectionId, date],
      ));
    for (const [studentId, status] of marks) {
      await ds.query(
        `INSERT INTO attendance_records (id, tenant_id, session_id, student_id, date, status, recorded_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())`,
        [tenantId, sid, studentId, date, status],
      );
    }
  };

  /** A school with a (current or past) year, section, CT + assistant, and one student X. */
  const mkTenant = async (current = true) => {
    const tenantId = await one(
      `INSERT INTO schools (name, slug) VALUES ('class-rules', 'class-rules-' || $1) RETURNING id`,
      [uniq()],
    );
    const yearId = await one(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES (gen_random_uuid(), 'Y', '2026-01-01', '2026-12-31', $1, $2, NOW(), NOW()) RETURNING id`,
      [current, tenantId],
    );
    const classId = await one(
      `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES (gen_random_uuid(), 'Six', $1, $2, NOW(), NOW()) RETURNING id`,
      [yearId, tenantId],
    );
    const sectionId = await one(
      `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
       VALUES (gen_random_uuid(), 'A', $1, $2, NOW(), NOW()) RETURNING id`,
      [classId, tenantId],
    );
    const ct = await mkTeacher(tenantId, sectionId, 'CLASS_TEACHER');
    const at = await mkTeacher(tenantId, sectionId, 'ASSISTANT_CLASS_TEACHER');
    const x = await mkStudent(tenantId, sectionId, 'Student X');
    await mkGuardian(tenantId, x, '01700000000');
    return { tenantId, sectionId, ct, at, x };
  };
  const absentThreeDays = async (t: { tenantId: string; sectionId: string; x: string }) => {
    for (const d of DAYS) await mark(t.tenantId, t.sectionId, d, [[t.x, AttendanceStatus.ABSENT]]);
  };
  const run = async (rule: AttentionRule, tenantId: string) => {
    const c = ctx(tenantId);
    return writer.apply(c, rule, await rule.evaluate(c));
  };
  const status = async (tenantId: string, ruleKey: string) =>
    (
      await ds.query(`SELECT status FROM alerts WHERE tenant_id = $1 AND rule_key = $2`, [
        tenantId,
        ruleKey,
      ])
    ).map((r: { status: string }) => r.status);

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [AlertWriterService],
      [
        ConfigModule.forRoot({ isGlobal: true }),
        BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
        AuthModule,
        TenantStatusModule,
        AttendanceModule, // only for the Epic 47 equivalence check
        ClassRulesModule,
      ],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    streak = module.get(ClassAbsentStreakRule, { strict: false });
    contact = module.get(ClassGuardianContactMissingRule, { strict: false });
    summary = module.get(AttendanceSummaryService, { strict: false });
  }, 60000);

  afterAll(async () => {
    await ds.destroy();
  });

  it('absent streak goes to the class teacher and the assistant, and only to them', async () => {
    const t = await mkTenant();
    await absentThreeDays(t);
    const [f] = await streak.evaluate(ctx(t.tenantId));
    expect(f.dedupeKey).toBe(`student:${t.x}:2026-10-06`);
    expect(f.params).toMatchObject({ days: 3, since: '2026-10-06', sectionLabel: 'Six-A' });
    expect(f.recipients.map((r) => r.userId).sort()).toEqual([t.ct, t.at].sort());
    expect(f.recipients.every((r) => r.role === UserRole.TEACHER)).toBe(true);
  });

  it('does not fire when the newest day is PRESENT, and resolves once the student returns', async () => {
    const t = await mkTenant();
    await absentThreeDays(t);
    expect((await run(streak, t.tenantId)).created).toBe(1);
    expect(await status(t.tenantId, 'class.absent_streak')).toEqual(['ACTIVE']);

    await mark(t.tenantId, t.sectionId, '2026-10-09', [[t.x, AttendanceStatus.PRESENT]]);
    expect(await streak.evaluate(ctx(t.tenantId))).toEqual([]);
    await run(streak, t.tenantId);
    expect(await status(t.tenantId, 'class.absent_streak')).toEqual(['RESOLVED']);
  });

  it('ignores a section whose academic year is not current', async () => {
    const t = await mkTenant(false);
    await absentThreeDays(t);
    expect(await streak.evaluate(ctx(t.tenantId))).toEqual([]);
    expect(await contact.evaluate(ctx(t.tenantId))).toEqual([]);
  });

  it("never leaks another tenant's students or teachers", async () => {
    const a = await mkTenant();
    const b = await mkTenant();
    await absentThreeDays(b);
    expect(await streak.evaluate(ctx(a.tenantId))).toEqual([]);
    const [f] = await streak.evaluate(ctx(b.tenantId));
    expect(f.params.studentId).toBe(b.x);
    expect(f.recipients.map((r) => r.userId).sort()).toEqual([b.ct, b.at].sort());
  });

  it('counts students whose guardians have no phone (blank counts as none)', async () => {
    const t = await mkTenant();
    expect(await contact.evaluate(ctx(t.tenantId))).toEqual([]); // X has a phone
    const noGuardian = await mkStudent(t.tenantId, t.sectionId, 'No guardian');
    const blank = await mkStudent(t.tenantId, t.sectionId, 'Blank phone');
    await mkGuardian(t.tenantId, blank, '  ');
    expect(noGuardian).not.toBe(blank);
    const [f] = await contact.evaluate(ctx(t.tenantId));
    expect(f.params).toMatchObject({ sectionId: t.sectionId, count: 2 });
    expect(f.recipients.map((r) => r.userId).sort()).toEqual([t.ct, t.at].sort());
  });

  it('matches the Epic 47 section streaks', async () => {
    const t = await mkTenant();
    const y = await mkStudent(t.tenantId, t.sectionId, 'Student Y');
    await absentThreeDays(t);
    // Y: absent only the last two days -> below the threshold.
    await mark(t.tenantId, t.sectionId, DAYS[1], [[y, AttendanceStatus.ABSENT]]);
    await mark(t.tenantId, t.sectionId, DAYS[2], [[y, AttendanceStatus.ABSENT]]);
    const epic47 = await summary.getSectionStreaks({
      tenantId: t.tenantId,
      sectionId: t.sectionId,
    });
    const expected = epic47.items
      .filter((i) => i.status === AttendanceStatus.ABSENT)
      .map((i) => i.student_id)
      .sort();
    const got = (await streak.evaluate(ctx(t.tenantId))).map((f) => f.params.studentId).sort();
    expect(got).toEqual(expected);
    expect(got).toEqual([t.x]);
  });
});
