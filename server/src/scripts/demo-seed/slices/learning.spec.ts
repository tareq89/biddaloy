import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { PromotionsService } from '../../../modules/promotions/promotions.service';
import { EnrollmentService } from '../../../modules/enrollments/enrollments.service';
import { StudentLifecycleService } from '../../../modules/students/student-lifecycle.service';
import { ApprovalService } from '../../../modules/auth/guards/approval.guard';
import { AuditService } from '../../../modules/audit/audit.service';
import { StorageService } from '../../../modules/storage/storage.service';
import { TenantSettingsCache } from '../../../modules/schools/settings/tenant-settings-cache.service';
import { SchoolsService } from '../../../modules/schools/schools.service';
import { resolveTenantSettings } from '../../../modules/schools/settings/tenant-settings-resolver';
import { SchoolSettingsReader } from '../../../modules/schools/settings/school-settings-reader.service';
import { PresetApplyService } from '../../../modules/presets/preset-apply.service';
import { PresetRegistryService } from '../../../modules/presets/preset-registry.service';
import { AuthTokenService } from '../../../modules/account-access/auth-token.service';
import { SchoolInviteService } from '../../../modules/account-access/school-invite.service';
import { StaffProfilesService } from '../../../modules/staff-profiles/staff-profiles.service';
import { TeacherService, UserService } from '../../../modules/users/users.service';
import { AccessTokenDenylistService } from '../../../modules/auth/access-token-denylist.service';
import { SessionCutoffService } from '../../../modules/auth/session-cutoff.service';
import { RefreshTokenService } from '../../../modules/auth/refresh-token.service';
import { ACCESS_TOKEN_TTL_MS } from '../../../modules/auth/auth-tokens';
import { RoutineService } from '../../../modules/routines/routine.service';
import { RoutineSlotsService } from '../../../modules/routines/routine-slots.service';
import { RoutineStateService } from '../../../modules/routines/routine-state.service';
import { SubstitutionsService } from '../../../modules/routines/substitutions.service';
import { ChangeRequestsService } from '../../../modules/routines/change-requests.service';
import { TeacherBusyService } from '../../../modules/routines/teacher-busy.service';
import { DEMO_CARDS } from '../../../modules/demo/demo-accounts';
import { createContext, type DemoSeedContext } from '../context';
import { validate } from '../validator';
import { slice as org } from './org';
import { slice as staff } from './staff';
import { slice as students } from './students';
import { slice as routine } from './routine';
import { slice } from './learning';

const ANCHOR = '2026-10-10'; // a Saturday

describe('learning slice (integration, 2 years, scale 0.05)', () => {
  let ds: DataSource;
  let ctx: DemoSeedContext;

  const q = <T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);

  let app: TestingModule;

  beforeAll(async () => {
    const module: TestingModule = await createTestModule(ALL_ENTITIES, [
      PresetApplyService,
      PresetRegistryService,
      AuditService,
      AuthTokenService,
      SchoolInviteService,
      StaffProfilesService,
      UserService,
      TeacherService,
      PromotionsService,
      EnrollmentService,
      StudentLifecycleService,
      { provide: ApprovalService, useValue: { consume: vi.fn() } },
      RoutineService,
      RoutineSlotsService,
      RoutineStateService,
      SubstitutionsService,
      ChangeRequestsService,
      { provide: TeacherBusyService, useValue: { busyAt: async () => null } },
      {
        provide: SchoolsService,
        useValue: { getResolvedSettings: async () => resolveTenantSettings(null) },
      },
      { provide: SchoolSettingsReader, useValue: { routineSettings: async () => ({}) } },
      { provide: ACCESS_TOKEN_TTL_MS, useValue: 900_000 },
      { provide: AccessTokenDenylistService, useValue: { revokeUserTokensIssuedBefore: vi.fn() } },
      { provide: SessionCutoffService, useValue: { cutOff: vi.fn() } },
      { provide: RefreshTokenService, useValue: {} },
      { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
      { provide: StorageService, useValue: { put: async () => undefined } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    app = module;
  }, 120_000);

  // The slice takes about a minute and the test setup empties the tables before every `it`, so
  // the slices run here, and the single `it` below reads the result in sections.
  beforeEach(async () => {
    await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    await ds.query(`DELETE FROM public_holiday_sets WHERE country = 'BD'`);
    ctx = await createContext({
      ds,
      app,
      scale: 0.05,
      years: 2,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    await org.run(ctx);
    await staff.run(ctx);
    await students.run(ctx);
    await routine.run(ctx);
    await slice.run(ctx);
  }, 600_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('seeds homework with defaulters, syllabus, study plans, deliveries and programs', async () => {
    const anchorPlus1 = new Date(Date.parse(ANCHOR) + 86_400_000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.parse(ANCHOR) - 86_400_000).toISOString().slice(0, 10);

    // Homework is due on the anchor date and the day after.
    const due = await q<{ due: string }>(
      `SELECT DISTINCT due_date::text AS due FROM homework_assignments WHERE due_date IN ($1, $2)`,
      [ANCHOR, anchorPlus1],
    );
    expect(due.map((d) => d.due).sort()).toEqual([ANCHOR, anchorPlus1]);

    // Yesterday's homework has defaulters: this is what the homework-defaulter job reads.
    const [{ n: defaulters }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM homework_submissions s
         JOIN homework_assignments a ON a.id = s.assignment_id
        WHERE a.due_date = $1 AND s.status = 'NOT_SUBMITTED'`,
      [yesterday],
    );
    expect(Number(defaulters)).toBeGreaterThan(0);

    // The sweep only runs for schools that opted in.
    const [{ n: optedOut }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM schools WHERE id IN (SELECT tenant_id FROM homework_assignments) AND (settings->'homework'->>'notifyDefaulters') IS DISTINCT FROM 'true'`,
    );
    expect(Number(optedOut)).toBe(0);

    // Submissions exist for the assignments (the unique index allows one per assignment and pupil).
    expect(
      Number((await q(`SELECT count(*) AS n FROM homework_submissions`))[0].n),
    ).toBeGreaterThan(0);

    // Syllabus and plans: every plan has lessons that point at real topics.
    expect(Number((await q(`SELECT count(*) AS n FROM syllabus_topics`))[0].n)).toBeGreaterThan(0);
    const [{ n: orphans }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM study_plans p, jsonb_array_elements(p.lessons) l
        WHERE NOT EXISTS (SELECT 1 FROM syllabus_topics t WHERE t.id = (l->>'topic_id')::uuid)`,
    );
    expect(Number(orphans)).toBe(0);

    // Lesson deliveries sit only on a routine slot of that section, subject and weekday, on a school day.
    const [{ n: stray }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM lesson_deliveries d
        WHERE extract(dow FROM d.date) = 5 OR NOT EXISTS (
          SELECT 1 FROM routine_slots rs
           WHERE rs.section_id = d.section_id AND rs.subject_id = d.subject_id
             AND rs.period_slot_id = d.period_slot_id AND rs.weekday = extract(dow FROM d.date))`,
    );
    expect(Number(stray)).toBe(0);
    expect(Number((await q(`SELECT count(*) AS n FROM lesson_deliveries`))[0].n)).toBeGreaterThan(
      0,
    );

    // Every program has milestones and at least one achievement; Hifz is not in College.
    const programs = await q<{
      name: string;
      slug: string;
      milestones: string;
      achievements: string;
    }>(
      `SELECT p.name, s.slug,
              (SELECT count(*) FROM program_milestones m WHERE m.program_id = p.id) AS milestones,
              (SELECT count(*) FROM milestone_achievements a WHERE a.program_id = p.id) AS achievements
         FROM programs p JOIN schools s ON s.id = p.tenant_id WHERE s.slug LIKE 'bmsc-%'`,
    );
    expect(programs.length).toBeGreaterThan(0);
    for (const p of programs) {
      expect(Number(p.milestones), `${p.slug} ${p.name} milestones`).toBeGreaterThan(0);
      expect(Number(p.achievements), `${p.slug} ${p.name} achievements`).toBeGreaterThan(0);
    }
    expect(programs.filter((p) => p.name === 'Hifz' && p.slug === 'bmsc-college')).toEqual([]);
    expect(
      (await validate(ds)).filter((v) => /homework|program|study|lesson/.test(v.check)),
    ).toEqual([]);
  }, 120_000);
});
