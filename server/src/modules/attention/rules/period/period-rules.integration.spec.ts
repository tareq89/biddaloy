import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { TENANT_STATUS_REDIS } from '../../../schools/tenant-status.service';
import { SchoolCalendarService } from '../../../calendar/school-calendar.service';
import { ResolveRoutineService } from '../../../routines/resolve-routine.service';
import { SubstitutionsService } from '../../../routines/substitutions.service';
import { AlertWriterService } from '../../engine/alert-writer.service';
import type { RuleContext } from '../rule.types';
import { ClassStartingRule } from './class-starting.rule';
import { RoutineSubstitutionTodayRule } from './routine-substitution-today.rule';
import { RoutineUncoveredPeriodsRule } from './routine-uncovered-periods.rule';

// A Monday inside every tenant's 2043 academic year.
const DAY = '2043-03-02';

describe('Period rules (integration)', () => {
  let ds: DataSource;
  let redis: Redis;
  let writer: AlertWriterService;
  let starting: ClassStartingRule;
  let substitution: RoutineSubstitutionTodayRule;
  let uncovered: RoutineUncoveredPeriodsRule;
  let substitutions: SubstitutionsService;

  interface Tenant {
    id: string;
    routineId: string;
    userOf: Record<string, string>; // T1, T2, T3, SUB, EXEC, ADMIN -> user id
    slotOf: Record<string, string>; // S1 (T1 10:00), S2 (T3 12:00, covered by SUB), S3 (T2 11:00, on leave)
  }
  let A: Tenant;
  let B: Tenant;

  const rand = () => Math.random().toString(36).slice(2, 9);
  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);
  const ctx = (t: Tenant, localTime: string): RuleContext => ({
    tenantId: t.id,
    now: new Date(`${DAY}T04:00:00Z`),
    tz: 'Asia/Dhaka',
    localDate: DAY,
    localTime,
    isWorkingDay: true,
    settings: { classStartingLeadMinutes: 10 } as RuleContext['settings'],
  });

  async function mkUser(tenantId: string, role: string) {
    const [{ id }] = await q(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Period Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`period-${rand()}@example.com`],
    );
    await q(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [
      id,
      tenantId,
      role,
    ]);
    return id as string;
  }

  /** Everything is wiped between tests, so each test builds its own tenants. */
  async function mkTenant(): Promise<Tenant> {
    const [{ id }] = await q(
      `INSERT INTO schools (name, slug) VALUES ('Period Test', $1) RETURNING id`,
      [`period-${rand()}`],
    );
    const [{ id: yearId }] = await q(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('2043', '2043-01-01', '2043-12-31', true, $1) RETURNING id`,
      [id],
    );
    const [{ id: classId }] = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Seven', $1, $2) RETURNING id`,
      [yearId, id],
    );
    const [{ id: sectionId }] = await q(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'B', $2) RETURNING id`,
      [classId, id],
    );
    const userOf: Record<string, string> = {
      EXEC: await mkUser(id, 'EXECUTIVE'),
      ADMIN: await mkUser(id, 'ADMIN'),
    };
    const teacherOf: Record<string, string> = {};
    for (const name of ['T1', 'T2', 'T3', 'SUB']) {
      userOf[name] = await mkUser(id, 'TEACHER');
      const [{ id: sp }] = await q(
        `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING id`,
        [userOf[name], id, `SP-${rand()}`],
      );
      [{ id: teacherOf[name] }] = await q(
        `INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, '{}', $3, $4, NOW(), NOW()) RETURNING id`,
        [userOf[name], `T-${rand()}`, id, sp],
      );
      if (name === 'T2') {
        await q(
          `INSERT INTO leave_records (tenant_id, staff_profile_id, leave_type, start_date, end_date, days, status)
           VALUES ($1, $2, 'SICK', $3, $3, 1, 'APPROVED')`,
          [id, sp, DAY],
        );
      }
    }
    const [{ id: subjectId }] = await q(
      `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, 'Math', 'গণিত', $2) RETURNING id`,
      [id, `M-${rand()}`],
    );
    const [{ id: routineId }] = await q(
      `INSERT INTO routines (tenant_id, academic_year_id, name, state, published_at)
       VALUES ($1, $2, 'R', 'PUBLISHED', NOW()) RETURNING id`,
      [id, yearId],
    );
    const [{ id: shiftId }] = await q(
      `INSERT INTO shifts (tenant_id, name, day_starts_at, day_ends_at, sequence)
       VALUES ($1, $2, '08:00', '14:00', 0) RETURNING id`,
      [id, `S-${rand()}`],
    );
    const slotOf: Record<string, string> = {};
    const plan: [string, string, string, string, string][] = [
      ['S1', 'T1', '10:00', '10:40', '0'],
      ['S3', 'T2', '11:00', '11:40', '1'],
      ['S2', 'T3', '12:00', '12:40', '2'],
    ];
    for (const [slotName, teacher, from, to, seq] of plan) {
      const [{ id: periodId }] = await q(
        `INSERT INTO period_slots (tenant_id, shift_id, sequence, kind, starts_at, ends_at)
         VALUES ($1, $2, $3, 'CLASS', $4, $5) RETURNING id`,
        [id, shiftId, Number(seq), from, to],
      );
      const [{ id: slotId }] = await q(
        `INSERT INTO routine_slots (tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id,
           recurrence, recurrence_offset, valid_from)
         VALUES ($1, $2, $3, $4, 1, $5, 'WEEKLY', 0, '2043-01-01') RETURNING id`,
        [id, routineId, sectionId, periodId, subjectId],
      );
      await q(
        `INSERT INTO routine_slot_teachers (tenant_id, routine_slot_id, teacher_id) VALUES ($1, $2, $3)`,
        [id, slotId, teacherOf[teacher]],
      );
      slotOf[slotName] = slotId;
    }
    // T3's 12:00 period is covered by SUB.
    await q(
      `INSERT INTO routine_substitutions (tenant_id, routine_slot_id, date, substitute_teacher_id, is_cancelled, created_by)
       VALUES ($1, $2, $3, $4, false, $5)`,
      [id, slotOf.S2, DAY, teacherOf.SUB, userOf.ADMIN],
    );
    return Object.assign({ id, routineId, userOf, slotOf }, { teacherOf }) as Tenant;
  }

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        AlertWriterService,
        { provide: TENANT_STATUS_REDIS, useValue: redis },
        ResolveRoutineService,
        SubstitutionsService,
        // Only the school calendar is stubbed (every day is a working day).
        {
          provide: SchoolCalendarService,
          useValue: { getWorkingDays: async () => ({ dates: [DAY] }) },
        },
        ClassStartingRule,
        RoutineSubstitutionTodayRule,
        RoutineUncoveredPeriodsRule,
      ],
      [],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    starting = module.get(ClassStartingRule);
    substitution = module.get(RoutineSubstitutionTodayRule);
    uncovered = module.get(RoutineUncoveredPeriodsRule);
    substitutions = module.get(SubstitutionsService);
  }, 60000);

  afterAll(async () => {
    redis.disconnect();
    await ds.destroy();
  });

  beforeEach(async () => {
    A = await mkTenant();
    B = await mkTenant();
  });

  it('fires: class.starting for T1, substitution_today for SUB, uncovered to EXECUTIVE + ADMIN', async () => {
    // 10:30: T1's period is running; T2's (on leave, nobody covering) is next.
    const [start] = await starting.evaluate(ctx(A, '10:30'));
    expect(start.recipients).toEqual([{ userId: A.userOf.T1, role: UserRole.TEACHER }]);
    expect(start.dedupeKey).toBe(`routine_slot:${A.slotOf.S1}:${DAY}`);

    const [sub] = await substitution.evaluate(ctx(A, '10:30'));
    expect(sub.recipients).toEqual([{ userId: A.userOf.SUB, role: UserRole.TEACHER }]);
    expect(sub.params).toMatchObject({ count: 1, firstSection: 'Seven-B', firstAt: '12:00' });

    const [gap] = await uncovered.evaluate(ctx(A, '10:30'));
    expect(gap.params).toMatchObject({ count: 1, firstAt: '11:00' });
    expect(gap.recipients.map((r) => r.userId).sort()).toEqual(
      [A.userOf.EXEC, A.userOf.ADMIN].sort(),
    );
  });

  it('does not fire: a draft routine has no class.starting; a substituted period is not uncovered', async () => {
    await q(`UPDATE routines SET state = 'DRAFT' WHERE id = $1`, [A.routineId]);
    expect(await starting.evaluate(ctx(A, '10:30'))).toEqual([]);
    expect(await uncovered.evaluate(ctx(A, '10:30'))).toEqual([]);

    await q(`UPDATE routines SET state = 'PUBLISHED' WHERE id = $1`, [A.routineId]);
    await q(`DELETE FROM leave_records WHERE tenant_id = $1`, [A.id]);
    expect(await uncovered.evaluate(ctx(A, '10:30'))).toEqual([]);
  });

  it("tenant isolation: B's people never receive A's findings", async () => {
    const all = [
      ...(await starting.evaluate(ctx(A, '10:30'))),
      ...(await substitution.evaluate(ctx(A, '10:30'))),
      ...(await uncovered.evaluate(ctx(A, '10:30'))),
    ].flatMap((f) => f.recipients.map((r) => r.userId));
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((u) => Object.values(B.userOf).includes(u))).toBe(false);
  });

  it('resolves: recording a substitute for the uncovered period clears the alert', async () => {
    const c = ctx(A, '10:30');
    await writer.apply(c, uncovered, await uncovered.evaluate(c));
    const status = async () =>
      (
        await q(`SELECT status FROM alerts WHERE tenant_id = $1 AND rule_key = $2`, [
          A.id,
          'routine.uncovered_periods',
        ])
      )[0].status;
    expect(await status()).toBe('ACTIVE');

    const { teacherOf } = A as unknown as { teacherOf: Record<string, string> };
    await substitutions.record(
      { routine_slot_id: A.slotOf.S3, date: DAY, substitute_teacher_id: teacherOf.SUB } as never,
      A.id,
      A.userOf.ADMIN,
    );
    await writer.apply(c, uncovered, await uncovered.evaluate(c));
    expect(await status()).toBe('RESOLVED');
  });
});
