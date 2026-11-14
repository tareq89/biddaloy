import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { AuthModule } from '../../../auth/auth.module';
import { TenantStatusModule } from '../../../schools/tenant-status.module';
import { DEFAULT_TENANT_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import { AlertWriterService } from '../../engine/alert-writer.service';
import type { RuleContext } from '../rule.types';
import { PromotionGroupsPendingRule } from './promotion-groups-pending.rule';
import { PromotionRulesModule } from './promotion-rules.module';

describe('promotion.groups_pending (integration)', () => {
  let ds: DataSource;
  let writer: AlertWriterService;
  let rule: PromotionGroupsPendingRule;
  let seq = 0;

  const ctx = (tenantId: string): RuleContext => ({
    tenantId,
    now: new Date('2026-10-10T05:00:00Z'),
    tz: 'Asia/Dhaka',
    localDate: '2026-10-10',
    localTime: '11:00',
    isWorkingDay: true,
    settings: { ...DEFAULT_TENANT_SETTINGS.attention! },
  });
  const one = async (sql: string, params: unknown[]) =>
    (await ds.query(sql, params))[0].id as string;
  const uniq = () => `${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 7)}`;

  const mkUser = async (tenantId: string, role: UserRole) => {
    const id = await one(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Promo Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`promo-${uniq()}@example.com`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return id;
  };
  const mkTeacher = async (tenantId: string, sectionId: string) => {
    const userId = await mkUser(tenantId, UserRole.TEACHER);
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
       VALUES (gen_random_uuid(), $1, $2, $3, 'CLASS_TEACHER', NOW())`,
      [teacherId, sectionId, tenantId],
    );
    return userId;
  };
  const mkYear = (tenantId: string, name: string, s: string, e: string, current: boolean) =>
    one(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id`,
      [name, s, e, current, tenantId],
    );
  const mkClass = (tenantId: string, yearId: string, name: string) =>
    one(
      `INSERT INTO classes (name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
      [name, yearId, tenantId],
    );
  const mkSection = (tenantId: string, classId: string, name: string, group: string | null) =>
    one(
      `INSERT INTO class_sections (section_name, class_id, tenant_id, group_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
      [name, classId, tenantId, group],
    );

  /**
   * Past year (source) with sections A and B, next year class Nine with grouped sections
   * (or ungrouped when `grouped` is false), a DRAFT run, and entries: 2 no-group in A, 1 in B.
   */
  const mkTenant = async (grouped: boolean) => {
    const tenantId = await one(
      `INSERT INTO schools (name, slug) VALUES ('promo-rules', 'promo-rules-' || $1) RETURNING id`,
      [uniq()],
    );
    const admin = await mkUser(tenantId, UserRole.ADMIN);
    const past = await mkYear(tenantId, '2025', '2025-01-01', '2025-12-31', false);
    const next = await mkYear(tenantId, '2026', '2026-01-01', '2026-12-31', true);
    const eight = await mkClass(tenantId, past, 'Eight');
    const secA = await mkSection(tenantId, eight, 'A', null);
    const secB = await mkSection(tenantId, eight, 'B', null);
    const nine = await mkClass(tenantId, next, 'Nine');
    await mkSection(tenantId, nine, 'Sci', grouped ? 'Science' : null);
    const teacherA = await mkTeacher(tenantId, secA); // past year: not current, must still be found
    const teacherB = await mkTeacher(tenantId, secB);
    const runId = await one(
      `INSERT INTO promotion_runs (tenant_id, source_class_id, source_academic_year_id, target_academic_year_id, target_class_id, exam_ids, algorithm, status, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, '{}', 'MERIT', 'DRAFT', $6) RETURNING id`,
      [tenantId, eight, past, next, nine, admin],
    );
    const entry = async (sectionId: string, groupName: string | null) => {
      const studentId = await one(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
         VALUES ('S', $1, $4, $2, $3, 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [uniq(), sectionId, tenantId, ++seq],
      );
      const enrollmentId = await one(
        `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id, enrollment_status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE') RETURNING id`,
        [studentId, eight, sectionId, past, tenantId],
      );
      await ds.query(
        `INSERT INTO promotion_entries (tenant_id, run_id, student_id, source_enrollment_id, source_section_id, passed_all, suggested_outcome, final_outcome, group_name, target_class_id)
         VALUES ($1, $2, $3, $4, $5, true, 'PROMOTE', 'PROMOTE', $6, $7)`,
        [tenantId, runId, studentId, enrollmentId, sectionId, groupName, nine],
      );
    };
    await entry(secA, null);
    await entry(secA, null);
    await entry(secA, 'Science'); // already grouped: not counted
    await entry(secB, null);
    return { tenantId, admin, secA, secB, teacherA, teacherB, runId };
  };

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [AlertWriterService],
      [
        ConfigModule.forRoot({ isGlobal: true }),
        BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
        AuthModule,
        TenantStatusModule,
        PromotionRulesModule,
      ],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    rule = module.get(PromotionGroupsPendingRule, { strict: false });
  }, 60000);

  afterAll(async () => {
    await ds.destroy();
  });

  it('counts per source section; each teacher sees only their own section, plus the admin', async () => {
    const t = await mkTenant(true);
    const found = await rule.evaluate(ctx(t.tenantId));
    const a = found.find((f) => f.params.sectionId === t.secA)!;
    const b = found.find((f) => f.params.sectionId === t.secB)!;
    expect(a.params).toMatchObject({ count: 2, sectionLabel: 'Eight-A' });
    expect(b.params).toMatchObject({ count: 1, sectionLabel: 'Eight-B' });
    expect(a.actionUrl).toBe(`/promotions/${t.runId}/groups`);
    // Teacher of section A must not receive section B's item, and vice versa.
    expect(a.recipients.map((r) => r.userId).sort()).toEqual([t.admin, t.teacherA].sort());
    expect(b.recipients.map((r) => r.userId).sort()).toEqual([t.admin, t.teacherB].sort());
  });

  it('is silent when the target class has no groups', async () => {
    const t = await mkTenant(false);
    expect(await rule.evaluate(ctx(t.tenantId))).toEqual([]);
  });

  it("does not leak into another tenant's run", async () => {
    const t = await mkTenant(true);
    const other = await mkTenant(true);
    const found = await rule.evaluate(ctx(t.tenantId));
    expect(found.every((f) => f.dedupeKey.startsWith(`promotion:${t.runId}:`))).toBe(true);
    expect(other.runId).not.toBe(t.runId);
  });

  it('resolves when the groups are set and when the run commits', async () => {
    const t = await mkTenant(true);
    const c = ctx(t.tenantId);
    expect((await writer.apply(c, rule, await rule.evaluate(c))).created).toBe(2);

    await ds.query(
      `UPDATE promotion_entries SET group_name = 'Science' WHERE run_id = $1 AND source_section_id = $2`,
      [t.runId, t.secB],
    );
    await writer.apply(c, rule, await rule.evaluate(c));
    const status = async () =>
      (await ds.query(
        `SELECT dedupe_key, status FROM alerts WHERE tenant_id = $1 AND rule_key = 'promotion.groups_pending' ORDER BY dedupe_key`,
        [t.tenantId],
      )) as { dedupe_key: string; status: string }[];
    expect((await status()).filter((r) => r.status === 'ACTIVE')).toHaveLength(1);

    await ds.query(
      `UPDATE promotion_runs SET status = 'COMMITTED', committed_at = NOW() WHERE id = $1`,
      [t.runId],
    );
    await writer.apply(c, rule, await rule.evaluate(c));
    expect((await status()).filter((r) => r.status === 'ACTIVE')).toHaveLength(0);
  });
});
