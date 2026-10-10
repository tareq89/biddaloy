import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { PeriodSlotKind, SlotRecurrence, TeacherAssignmentType, UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { TENANT_STATUS_REDIS } from '../../../schools/tenant-status.service';
import { AuditService } from '../../../audit/audit.service';
import { SchoolSettingsReader } from '../../../schools/settings/school-settings-reader.service';
import { SectionService } from '../../../classes/classes.service';
import { RoutineStateService } from '../../../routines/routine-state.service';
import { SubstitutionsService } from '../../../routines/substitutions.service';
import { attentionEvents } from '../../attention.constants';
import { ATTENTION_RECHECK, AttentionRecheckPayload } from '../../engine/attention-events';
import { AlertWriterService } from '../../engine/alert-writer.service';
import type { RuleContext } from '../rule.types';
import { GuardianContactMissingRule } from './guardian-contact-missing.rule';
import { RoutineNotPublishedRule } from './routine-not-published.rule';
import { RoutineSubjectNoTeacherRule } from './routine-subject-no-teacher.rule';
import { SectionNoClassTeacherRule } from './section-no-class-teacher.rule';
import { StructureRulesModule } from './structure-rules.module';

// Monday inside both tenants' 2043 academic year.
const DAY = '2043-03-02';
const CONTEXT = { ip: null, userAgent: null };

describe('Structure rules (integration)', () => {
  let ds: DataSource;
  let redis: Redis;
  let writer: AlertWriterService;
  let notPublished: RoutineNotPublishedRule;
  let noClassTeacher: SectionNoClassTeacherRule;
  let noTeacher: RoutineSubjectNoTeacherRule;
  let contactMissing: GuardianContactMissingRule;
  let sections: SectionService;
  let routineState: RoutineStateService;
  let substitutions: SubstitutionsService;

  interface Tenant {
    id: string;
    adminId: string;
    classId: string;
    yearId: string;
    sectionIds: string[];
    routineId: string;
    periodSlotId: string;
    subjectId: string;
  }
  let A: Tenant;
  let B: Tenant;

  const ctx = (t: Tenant): RuleContext => ({
    tenantId: t.id,
    now: new Date(`${DAY}T04:00:00Z`),
    tz: 'Asia/Dhaka',
    localDate: DAY,
    localTime: '10:00',
    isWorkingDay: true,
    settings: {} as RuleContext['settings'],
  });

  const rand = () => Math.random().toString(36).slice(2, 9);

  async function mkTenant(sectionNames: string[]): Promise<Tenant> {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Structure Test', $1) RETURNING id`,
      [`structure-${rand()}`],
    );
    const [{ id: adminId }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Structure Admin', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`structure-${rand()}@example.com`],
    );
    await ds.query(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'ADMIN')`, [
      adminId,
      id,
    ]);
    const [{ id: yearId }] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('2043', '2043-01-01', '2043-12-31', true, $1) RETURNING id`,
      [id],
    );
    const [{ id: classId }] = await ds.query(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Six', $1, $2) RETURNING id`,
      [yearId, id],
    );
    const sectionIds: string[] = [];
    for (const name of sectionNames) {
      const [{ id: sid }] = await ds.query(
        `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, $2, $3) RETURNING id`,
        [classId, name, id],
      );
      sectionIds.push(sid);
    }
    return { id, adminId, classId, yearId, sectionIds } as Tenant;
  }

  // Routines, period slots and subjects are wiped between tests, so build them per test.
  async function mkRoutineKit(t: Tenant, name = 'R'): Promise<void> {
    const { id, yearId } = t;
    const [{ id: routineId }] = await ds.query(
      `INSERT INTO routines (tenant_id, academic_year_id, name, state) VALUES ($1, $2, $3, 'DRAFT') RETURNING id`,
      [id, yearId, name],
    );
    const [{ id: shiftId }] = await ds.query(
      `INSERT INTO shifts (tenant_id, name, day_starts_at, day_ends_at, sequence)
       VALUES ($1, $2, '08:00', '14:00', 0) RETURNING id`,
      [id, `S-${rand()}`],
    );
    const [{ id: periodSlotId }] = await ds.query(
      `INSERT INTO period_slots (tenant_id, shift_id, sequence, kind, starts_at, ends_at)
       VALUES ($1, $2, 0, $3, '08:00', '08:40') RETURNING id`,
      [id, shiftId, PeriodSlotKind.CLASS],
    );
    const [{ id: subjectId }] = await ds.query(
      `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, 'Math', 'গণিত', $2) RETURNING id`,
      [id, `M-${rand()}`],
    );
    Object.assign(t, { routineId, periodSlotId, subjectId });
  }

  const mkSlot = async (t: Tenant) =>
    (
      await ds.query(
        `INSERT INTO routine_slots (tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id,
           recurrence, recurrence_offset, valid_from)
         VALUES ($1, $2, $3, $4, 1, $5, $6, 0, '2043-01-01') RETURNING id`,
        [t.id, t.routineId, t.sectionIds[0], t.periodSlotId, t.subjectId, SlotRecurrence.WEEKLY],
      )
    )[0].id as string;

  const mkTeacher = async (t: Tenant) => {
    const [{ id: userId }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Structure Teacher', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`structure-t-${rand()}@example.com`],
    );
    const [{ id }] = await ds.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'SP-' || $3::text, NOW(), NOW()) RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT gen_random_uuid(), $1::uuid, 'ST-' || $3::text, '{}', $2::uuid, sp.id, NOW(), NOW() FROM sp
       RETURNING id`,
      [userId, t.id, rand()],
    );
    return id as string;
  };

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        AlertWriterService,
        AuditService,
        SectionService,
        RoutineStateService,
        SubstitutionsService,
        { provide: TENANT_STATUS_REDIS, useValue: redis },
        { provide: SchoolSettingsReader, useValue: {} },
      ],
      [StructureRulesModule],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    notPublished = module.get(RoutineNotPublishedRule);
    noClassTeacher = module.get(SectionNoClassTeacherRule);
    noTeacher = module.get(RoutineSubjectNoTeacherRule);
    contactMissing = module.get(GuardianContactMissingRule);
    sections = module.get(SectionService);
    routineState = module.get(RoutineStateService);
    substitutions = module.get(SubstitutionsService);
    A = await mkTenant(['A', 'B']);
    B = await mkTenant(['A', 'B', 'C']);
  }, 60000);

  afterAll(async () => {
    for (const t of [A, B]) {
      await ds.query(`DELETE FROM alerts WHERE tenant_id = $1`, [t.id]);
    }
    redis.disconnect();
    await ds.destroy();
  });

  it('section.no_class_teacher: counts only own tenant, then clears on assignment', async () => {
    // A: 2 sections, no class teacher; B: 3 sections, none either.
    const [fa] = await noClassTeacher.evaluate(ctx(A));
    expect(fa.params).toMatchObject({ count: 2, sections: 'Six-A, Six-B' });
    const [fb] = await noClassTeacher.evaluate(ctx(B));
    expect(fb.params.count).toBe(3);
    // Tenant isolation: B's admin is never a recipient of A's finding.
    expect(fa.recipients.map((r) => r.userId)).toEqual([A.adminId]);

    // Resolves: apply -> ACTIVE; assign through the real service; apply again -> RESOLVED.
    await writer.apply(ctx(A), noClassTeacher, [fa]);
    const teacherId = await mkTeacher(A);
    for (const sectionId of A.sectionIds) {
      await sections.assignTeacher(
        A.classId,
        sectionId,
        { teacher_id: teacherId, assignment_type: TeacherAssignmentType.CLASS_TEACHER } as never,
        A.id,
      );
    }
    expect(await noClassTeacher.evaluate(ctx(A))).toEqual([]);
    await writer.apply(ctx(A), noClassTeacher, []);
    const [{ status }] = await ds.query(
      `SELECT status FROM alerts WHERE tenant_id = $1 AND rule_key = 'section.no_class_teacher'`,
      [A.id],
    );
    expect(status).toBe('RESOLVED');
    // B untouched.
    expect((await noClassTeacher.evaluate(ctx(B)))[0].params.count).toBe(3);
  });

  it('routine.not_published: fires for DRAFT, clears once published, emits on transition', async () => {
    await mkRoutineKit(A);
    await mkRoutineKit(B);
    const [f] = await notPublished.evaluate(ctx(A));
    expect(f.params).toMatchObject({ year: '2043', state_en: 'draft' });

    const events: AttentionRecheckPayload[] = [];
    const on = (p: AttentionRecheckPayload) => events.push(p);
    attentionEvents.on(ATTENTION_RECHECK, on);
    try {
      await routineState.submitForReview(A.routineId, A.id, A.adminId, CONTEXT);
      await routineState.publish(A.routineId, A.id, A.adminId, CONTEXT);
    } finally {
      attentionEvents.off(ATTENTION_RECHECK, on);
    }
    expect(events.map((e) => e.ruleKey)).toEqual([
      'routine.not_published',
      'routine.not_published',
    ]);
    expect(events.every((e) => e.tenantId === A.id)).toBe(true);
    expect(await notPublished.evaluate(ctx(A))).toEqual([]);
    // B is still a draft.
    expect(await notPublished.evaluate(ctx(B))).toHaveLength(1);
  });

  it('routine.subject_no_teacher: counts teacherless CLASS slots, clears when a teacher is added', async () => {
    await mkRoutineKit(A);
    const slotId = await mkSlot(A);
    const [f] = await noTeacher.evaluate(ctx(A));
    expect(f.params.count).toBe(1);
    expect(await noTeacher.evaluate(ctx(B))).toEqual([]); // no slots in B

    const teacherId = await mkTeacher(A);
    await ds.query(
      `INSERT INTO routine_slot_teachers (tenant_id, routine_slot_id, teacher_id) VALUES ($1, $2, $3)`,
      [A.id, slotId, teacherId],
    );
    expect(await noTeacher.evaluate(ctx(A))).toEqual([]);

    // Recording a substitution asks the engine to re-check today's substitution rule.
    const events: AttentionRecheckPayload[] = [];
    const on = (p: AttentionRecheckPayload) => events.push(p);
    attentionEvents.on(ATTENTION_RECHECK, on);
    try {
      await substitutions.record(
        { routine_slot_id: slotId, date: DAY, is_cancelled: true } as never,
        A.id,
        A.adminId,
      );
    } finally {
      attentionEvents.off(ATTENTION_RECHECK, on);
    }
    expect(events).toEqual([
      { tenantId: A.id, ruleKey: 'routine.substitution_today', actorUserId: A.adminId },
      { tenantId: A.id, ruleKey: 'routine.changed_today', actorUserId: A.adminId },
    ]);
  });

  it('guardian.contact_missing: a student whose only guardian has no phone, then fixed', async () => {
    const [{ id: studentId }] = await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status)
       VALUES ('No Phone Kid', $1, 1, $2, $3, 'ACTIVE') RETURNING id`,
      [`REG-${rand()}`, A.sectionIds[0], A.id],
    );
    const [{ id: guardianId }] = await ds.query(
      `INSERT INTO guardians (full_name, relationship, phone, tenant_id) VALUES ('Parent', 'Father', '  ', $1) RETURNING id`,
      [A.id],
    );
    await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      studentId,
      guardianId,
    ]);
    const [f] = await contactMissing.evaluate(ctx(A));
    expect(f.params.count).toBe(1);
    expect(await contactMissing.evaluate(ctx(B))).toEqual([]);

    await ds.query(`UPDATE guardians SET phone = '01700000000' WHERE id = $1`, [guardianId]);
    expect(await contactMissing.evaluate(ctx(A))).toEqual([]);
  });

  it('tenant B admin is the only recipient of B findings', async () => {
    const [f] = await noClassTeacher.evaluate(ctx(B));
    expect(f.recipients).toEqual([{ userId: B.adminId, role: UserRole.ADMIN }]);
  });
});
