import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import {
  ApplicationEventKind,
  ApplicationStatus,
  ApplicationType,
  TeacherAssignmentType,
  UserRole,
} from '@biddaloy/shared';
import { AuthModule } from '../auth/auth.module';
import { Teacher } from '../academics/entities/teacher.entity';
import { ApplicationsModule } from './applications.module';
import { ApplicationsService } from './applications.service';
import { ApplicationDecisionsService } from './application-decisions.service';
import { ApplicationLetterService } from './application-letter.service';
import { ApplicationNotifyService } from './application-notify.service';
import type { ApplicationCaller } from './reviewer-scope';
import { Application } from './entities/application.entity';
import type { CreateApplicationDto } from './dto/application.dto';
import { BulkApproveDto } from './dto/decide.dto';
import { StaffLeaveHandler } from './handlers/staff-leave.handler';
import { StudentLeaveHandler } from './handlers/student-leave.handler';
import { FeeWaiverHandler } from './handlers/fee-waiver.handler';
import { SectionChangeHandler } from './handlers/section-change.handler';
import { ManualHandler } from './handlers/manual.handler';

/**
 * [52.3.1] Integration tests for `ApplicationDecisionsService` against the real, migrated test
 * database. Applications are seeded through `ApplicationsService.submit`; the effect handlers
 * (other tickets) and the notify/letter services are stubbed. The locks, the transaction,
 * the audit rows and the reviewer rules all run for real.
 *
 * Cast: ct = CLASS_TEACHER of section 1 (studentA); other = teacher with no section;
 * acct = ACCOUNTANT with a staff profile; exec/admin = override roles; office files on behalf.
 * studentB sits in section 2, which has no class teacher.
 */
describe('ApplicationDecisionsService (integration)', () => {
  let service: ApplicationDecisionsService;
  let applications: ApplicationsService;
  let dataSource: DataSource;
  let letter: ApplicationLetterService;
  let notify: ApplicationNotifyService;
  let handlers: {
    staffLeave: StaffLeaveHandler;
    studentLeave: StudentLeaveHandler;
    feeWaiver: FeeWaiverHandler;
    sectionChange: SectionChangeHandler;
    manual: ManualHandler;
  };

  const TENANT_B = randomUUID();
  const ctx = { ip: null, userAgent: null };
  const req = { ip: '10.0.0.1', headers: { 'user-agent': 'vitest' } } as unknown as Request;

  const u = {
    parent: randomUUID(),
    ct: randomUUID(),
    other: randomUUID(),
    office: randomUUID(),
    acct: randomUUID(),
    exec: randomUUID(),
    bAdmin: randomUUID(),
  };
  const callers = {
    parent: { userId: u.parent, role: UserRole.PARENT },
    ct: { userId: u.ct, role: UserRole.TEACHER },
    other: { userId: u.other, role: UserRole.TEACHER },
    office: { userId: u.office, role: UserRole.OFFICE_STAFF },
    acct: { userId: u.acct, role: UserRole.ACCOUNTANT },
    exec: { userId: u.exec, role: UserRole.EXECUTIVE },
    admin: { userId: SEED_ADMIN_USER_ID, role: UserRole.ADMIN },
  } satisfies Record<string, ApplicationCaller>;
  const bAdmin: ApplicationCaller = { userId: u.bAdmin, role: UserRole.ADMIN };

  let studentA: string;
  let studentB: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), ApplicationsModule, AuthModule],
    );
    service = module.get(ApplicationDecisionsService);
    applications = module.get(ApplicationsService);
    letter = module.get(ApplicationLetterService);
    notify = module.get(ApplicationNotifyService);
    handlers = {
      staffLeave: module.get(StaffLeaveHandler),
      studentLeave: module.get(StudentLeaveHandler),
      feeWaiver: module.get(FeeWaiverHandler),
      sectionChange: module.get(SectionChangeHandler),
      manual: module.get(ManualHandler),
    };
    dataSource = module.get<DataSource>(getDataSourceToken());

    const members: Array<[string, UserRole]> = [
      [u.parent, UserRole.PARENT],
      [u.ct, UserRole.TEACHER],
      [u.other, UserRole.TEACHER],
      [u.office, UserRole.OFFICE_STAFF],
      [u.acct, UserRole.ACCOUNTANT],
      [u.exec, UserRole.EXECUTIVE],
    ];
    for (const [id, role] of [...members, [u.bAdmin, UserRole.ADMIN] as [string, UserRole]]) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, `dec-${id}@test.com`, SEED_ADMIN_PASSWORD_HASH, `Name ${role} ${id.slice(0, 4)}`],
      );
    }
    for (const [id, role] of members) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
    }
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Decisions Tenant B', $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B, `decisions-b-${TENANT_B.slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'ADMIN', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [u.bAdmin, TENANT_B],
    );
  }, 90000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(letter, 'buildContext').mockResolvedValue({
      locale: 'en',
      date: '2026-10-09',
      school_name: '',
      to_title: '',
      applicant_name: '',
      applicant_relation: '',
      serial: null,
      subject_name: '',
      class_name: null,
      section_name: null,
      roll: null,
      ref_names: {},
      days: null,
    });
    vi.spyOn(letter, 'render').mockReturnValue('x');
    vi.spyOn(notify, 'onSubmitted').mockResolvedValue();
    vi.spyOn(notify, 'onStepAdvanced').mockResolvedValue();
    vi.spyOn(notify, 'onStatusChanged').mockResolvedValue();
    // Effect handlers belong to 52.3.2-52.3.5: stubbed here.
    vi.spyOn(handlers.staffLeave, 'apply').mockResolvedValue({ leave_record_id: 'r1' });
    vi.spyOn(handlers.staffLeave, 'cancel').mockResolvedValue();
    vi.spyOn(handlers.studentLeave, 'apply').mockResolvedValue({ days: 3 });
    vi.spyOn(handlers.studentLeave, 'cancel').mockResolvedValue();
    vi.spyOn(handlers.feeWaiver, 'apply').mockResolvedValue({ discount_rule_id: 'd1' });
    vi.spyOn(handlers.sectionChange, 'apply').mockResolvedValue({ moved: true });
    vi.spyOn(handlers.manual, 'apply').mockResolvedValue({ manual: true });

    const mkStudent = async (name: string, section: string, userId?: string) =>
      (
        await dataSource.query(
          `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                                 user_id, enrollment_status, preferred_communication, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
          [
            name,
            `DC-${randomUUID().slice(0, 10)}`,
            Math.floor(Math.random() * 1e6),
            section,
            SEED_TENANT_ID,
            userId ?? null,
          ],
        )
      )[0].id as string;
    studentA = await mkStudent('Student A', SEED_SECTION_1_ID);
    studentB = await mkStudent('Student B', SEED_SECTION_2_ID);

    const guardian = (
      await dataSource.query(
        `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                                preferred_communication, is_primary_contact, created_at, updated_at)
         VALUES ('Guardian P', 'FATHER', '+8801700000000', $1, $2, $3, 'SMS', true, NOW(), NOW()) RETURNING id`,
        [`g-${randomUUID()}@test.com`, SEED_TENANT_ID, u.parent],
      )
    )[0].id as string;
    for (const s of [studentA, studentB]) {
      await dataSource.query(
        `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
        [s, guardian],
      );
    }

    const teacherRepo = dataSource.getRepository(Teacher);
    const mkTeacher = async (userId: string) =>
      (
        await teacherRepo.save({
          user_id: userId,
          tenant_id: SEED_TENANT_ID,
          employee_id: `DC-${randomUUID().slice(0, 12)}`,
          designations: [],
        })
      ).id;
    await dataSource.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        await mkTeacher(u.ct),
        SEED_SECTION_1_ID,
        SEED_TENANT_ID,
        TeacherAssignmentType.CLASS_TEACHER,
      ],
    );
    await mkTeacher(u.other);

    for (const userId of [u.acct, SEED_ADMIN_USER_ID]) {
      await dataSource.query(
        `INSERT INTO staff_profiles (user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [userId, SEED_TENANT_ID, `DC-${randomUUID().slice(0, 12)}`],
      );
    }
  });

  // --- helpers -------------------------------------------------------------

  const submit = (c: ApplicationCaller, dto: CreateApplicationDto) =>
    applications.submit(SEED_TENANT_ID, c, dto, ctx);
  const studentLeave = (student: string) =>
    submit(callers.parent, {
      type: ApplicationType.STUDENT_LEAVE,
      subject_student_id: student,
      payload: {
        reason_kind: 'SICK',
        start_date: '2026-10-12',
        end_date: '2026-10-14',
        details: 'Fever, doctor advised rest',
      },
    });
  const staffLeave = (c: ApplicationCaller) =>
    submit(c, {
      type: ApplicationType.STAFF_LEAVE,
      payload: {
        leave_type: 'CASUAL',
        start_date: '2026-10-12',
        end_date: '2026-10-13',
        reason: 'Family event',
      },
    });
  /** Filed by OFFICE_STAFF on behalf of a parent (paper), so the applicant is nobody who decides. */
  const onBehalf = (
    type: ApplicationType,
    student: string,
    payload: Record<string, unknown>,
  ): Promise<{ id: string; current_step: number }> =>
    submit(callers.office, {
      type,
      subject_student_id: student,
      applicant_name: 'Abdul Karim',
      payload,
    });
  /** A paper STAFF_LEAVE the ADMIN enters about their own profile: no applicant user id. */
  const paperOwnLeave = async () => {
    const [{ id }] = await dataSource.query(
      `SELECT id FROM staff_profiles WHERE tenant_id = $1 AND user_id = $2`,
      [SEED_TENANT_ID, SEED_ADMIN_USER_ID],
    );
    return submit(callers.admin, {
      type: ApplicationType.STAFF_LEAVE,
      applicant_name: 'Paper',
      subject_staff_profile_id: id,
      payload: {
        leave_type: 'CASUAL',
        start_date: '2026-10-12',
        end_date: '2026-10-13',
        reason: 'Family event',
      },
    });
  };
  const testimonial = (student: string) =>
    onBehalf(ApplicationType.TESTIMONIAL, student, { purpose: 'Scholarship application' });
  const feeWaiver = (student: string) =>
    onBehalf(ApplicationType.FEE_WAIVER, student, {
      kind: 'PERCENT',
      value: 25,
      reason: 'Hardship in the family',
    });
  const sectionChange = (student: string) =>
    onBehalf(ApplicationType.SECTION_CHANGE, student, {
      to_section_id: SEED_SECTION_2_ID,
      reason: 'Closer to home',
    });

  const row = (id: string) => dataSource.getRepository(Application).findOneByOrFail({ id });
  const events = async (id: string) =>
    (await dataSource.query(
      `SELECT kind, step, note, data FROM application_events
        WHERE application_id = $1 ORDER BY created_at, id`,
      [id],
    )) as Array<{ kind: ApplicationEventKind; step: number; note: string | null; data: any }>;
  const auditRows = (id: string) =>
    dataSource.query(`SELECT old_values, new_values FROM audit_logs WHERE entity_id = $1`, [id]);
  const approve = (c: ApplicationCaller, id: string, dto = {}) =>
    service.approve(SEED_TENANT_ID, c, id, dto, req);
  const code = (err: unknown) => (err as ForbiddenException).getResponse() as any;

  // --- approve -------------------------------------------------------------

  describe('approve', () => {
    it('two-step TESTIMONIAL: class teacher advances, ADMIN approves; events and audit written', async () => {
      const app = await testimonial(studentA);

      const mid = await approve(callers.ct, app.id, { note: 'Good student' });
      expect(mid.status).toBe(ApplicationStatus.PENDING);
      expect(mid.current_step).toBe(1);
      expect(notify.onStepAdvanced).toHaveBeenCalledTimes(1);
      expect(notify.onStatusChanged).not.toHaveBeenCalled();

      const done = await approve(callers.admin, app.id);
      expect(done.status).toBe(ApplicationStatus.APPROVED);
      const saved = await row(app.id);
      expect(saved.decided_by_user_id).toBe(SEED_ADMIN_USER_ID);
      expect(saved.decided_at).not.toBeNull();
      expect(notify.onStatusChanged).toHaveBeenCalledTimes(1);

      // STEP_APPROVED records the step that was approved (0), not the one moved to.
      const evs = (await events(app.id)).filter((e) => e.kind !== ApplicationEventKind.SUBMITTED);
      expect(evs.map((e) => [e.kind, e.step])).toEqual([
        [ApplicationEventKind.STEP_APPROVED, 0],
        [ApplicationEventKind.APPROVED, 1],
      ]);
      expect(evs[0].data).toEqual({ auto_skipped: [] });
      expect(evs[0].note).toBe('Good student');

      const audits = await auditRows(app.id);
      expect(
        audits.some(
          (a: any) =>
            a.old_values.status === ApplicationStatus.PENDING &&
            a.new_values.status === ApplicationStatus.APPROVED,
        ),
      ).toBe(true);
    });

    it('a student with no class teacher starts past the class-teacher step; ADMIN approves it', async () => {
      // No catalogue type has a CLASS_TEACHER step after step 0, so the in-loop skip of
      // `approve` is defensive; the real skip happens at submit (52.2.1) and is checked here.
      const app = await testimonial(studentB);
      expect(app.current_step).toBe(1);
      const done = await approve(callers.admin, app.id);
      expect(done.status).toBe(ApplicationStatus.APPROVED);
    });

    it('concurrent approve race: exactly one wins, one event', async () => {
      const app = await studentLeave(studentA);
      const results = await Promise.allSettled([
        approve(callers.ct, app.id),
        approve(callers.ct, app.id),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(ConflictException);
      const approved = (await events(app.id)).filter(
        (e) => e.kind === ApplicationEventKind.APPROVED,
      );
      expect(approved).toHaveLength(1);
      expect(handlers.studentLeave.apply).toHaveBeenCalledTimes(1);
    });

    it('approve vs reject race: exactly one wins', async () => {
      const app = await studentLeave(studentA);
      const results = await Promise.allSettled([
        approve(callers.ct, app.id),
        service.reject(SEED_TENANT_ID, callers.ct, app.id, { reason: 'No' }, req),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect([ApplicationStatus.APPROVED, ApplicationStatus.REJECTED]).toContain(
        (await row(app.id)).status,
      );
    });

    it('D7 override: ADMIN approves a TESTIMONIAL at step 0 in one call, skipped step recorded', async () => {
      const app = await testimonial(studentA);
      const done = await approve(callers.admin, app.id);
      expect(done.status).toBe(ApplicationStatus.APPROVED);
      const approved = (await events(app.id)).find((e) => e.kind === ApplicationEventKind.APPROVED);
      expect(approved?.data).toEqual({
        override: true,
        skipped_steps: [{ step: 0, kind: 'CLASS_TEACHER' }],
      });
    });

    it('nobody decides their own application (D49): ADMIN applicant -> NOT_A_DECIDER', async () => {
      const app = await staffLeave(callers.admin);
      const err = await approve(callers.admin, app.id).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(code(err).details.code).toBe('NOT_A_DECIDER');
    });

    it("D49: a paper entry about the ADMIN's own staff profile cannot be approved by that ADMIN", async () => {
      const app = await paperOwnLeave();
      expect((await row(app.id)).applicant_user_id).toBeNull();
      const err = await approve(callers.admin, app.id).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(code(err).details.code).toBe('NOT_A_DECIDER');
      expect(handlers.staffLeave.apply).not.toHaveBeenCalled();
      // Another LEAVE_APPROVE holder still can.
      expect((await approve(callers.exec, app.id)).status).toBe(ApplicationStatus.APPROVED);
    });

    it('STUDENT_LEAVE final approval by its class teacher needs no effectPermission (D44)', async () => {
      const app = await studentLeave(studentA);
      const done = await approve(callers.ct, app.id);
      expect(done.status).toBe(ApplicationStatus.APPROVED);
      expect((await row(app.id)).effect_result).toEqual({ days: 3 });
    });

    it('final AUTO approval needs the effect permission: EXECUTIVE override on FEE_WAIVER is refused', async () => {
      const app = await feeWaiver(studentA);
      const err = await approve(callers.exec, app.id).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(code(err).details).toEqual({
        code: 'EFFECT_PERMISSION_REQUIRED',
        permission: 'DISCOUNT_RULE_MANAGE',
      });
      const saved = await row(app.id);
      expect(saved.status).toBe(ApplicationStatus.PENDING);
      expect(saved.current_step).toBe(0);
      expect(handlers.feeWaiver.apply).not.toHaveBeenCalled();
    });

    it('a viewer (OFFICE_STAFF) who does not meet the SECTION_CHANGE final step is NOT_A_DECIDER', async () => {
      const app = await sectionChange(studentB); // step 0 skipped: starts at the ADMIN step
      expect(app.current_step).toBe(1);
      const err = await approve(callers.office, app.id).catch((e) => e); // can view, cannot decide
      expect(code(err).details.code).toBe('NOT_A_DECIDER');
    });

    it('a handler failure rolls everything back: still open, no APPROVED event, no audit, no effect_result', async () => {
      const app = await studentLeave(studentA);
      vi.spyOn(handlers.studentLeave, 'apply').mockRejectedValue(new Error('balance exceeded'));
      await expect(approve(callers.ct, app.id)).rejects.toThrow('balance exceeded');

      const saved = await row(app.id);
      expect(saved.status).toBe(ApplicationStatus.PENDING);
      expect(saved.effect_result).toBeNull();
      expect(saved.decided_by_user_id).toBeNull();
      expect((await events(app.id)).map((e) => e.kind)).toEqual([ApplicationEventKind.SUBMITTED]);
      expect(await auditRows(app.id)).toHaveLength(0);
      expect(notify.onStatusChanged).not.toHaveBeenCalled();
    });

    it('GENERAL has no handler: approved with effect_result null', async () => {
      const app = await submit(callers.parent, {
        type: ApplicationType.GENERAL,
        subject_student_id: studentA,
        addressee: 'CLASS_TEACHER' as never,
        payload: { subject_line: 'Request', body: 'Please consider this request.' },
      });
      const done = await approve(callers.ct, app.id);
      expect(done.status).toBe(ApplicationStatus.APPROVED);
      expect((await row(app.id)).effect_result).toBeNull();
    });

    it('granted with a PERCENT over 100 or an end before the start is a 400 and nothing is written', async () => {
      const app = await feeWaiver(studentA);
      await approve(callers.ct, app.id); // now at the final (fee) step
      for (const granted of [
        { kind: 'PERCENT', value: 500 },
        { kind: 'FLAT', value: 100, start_date: '2026-12-01', end_date: '2026-11-01' },
        // Only the value is granted; the requested kind (PERCENT) still applies, so the
        // merged terms are 500% and must be caught before the step-up token is spent.
        { value: 500 },
      ]) {
        await expect(approve(callers.admin, app.id, { granted })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      const saved = await row(app.id);
      expect(saved.status).toBe(ApplicationStatus.PENDING);
      expect(saved.granted).toBeNull();
      expect(handlers.feeWaiver.apply).not.toHaveBeenCalled();
    });

    it('FEE_WAIVER final approval stores the merged grant, records it on the event and hands it to the handler', async () => {
      const app = await onBehalf(ApplicationType.FEE_WAIVER, studentA, {
        kind: 'PERCENT',
        value: 25,
        fee_types: ['MONTHLY_TUITION'],
        start_date: '2026-11-01',
        reason: 'Hardship in the family',
      });
      await approve(callers.ct, app.id);
      // The approver changes only the amount: the requested fee types and dates still apply (D39).
      const done = await approve(callers.admin, app.id, { granted: { kind: 'FLAT', value: 300 } });
      expect(done.status).toBe(ApplicationStatus.APPROVED);

      const granted = {
        kind: 'FLAT',
        value: 300,
        fee_types: ['MONTHLY_TUITION'],
        start_date: '2026-11-01',
        end_date: null,
      };
      const saved = await row(app.id);
      expect(saved.granted).toEqual(granted);
      expect(saved.effect_result).toEqual({ discount_rule_id: 'd1' });
      const ev = (await events(app.id)).find((e) => e.kind === ApplicationEventKind.APPROVED);
      expect(ev?.data.granted).toEqual(granted);
      expect(handlers.feeWaiver.apply).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ granted, actorUserId: SEED_ADMIN_USER_ID }),
      );
    });

    it('granted is refused on a non-FEE_WAIVER type', async () => {
      const app = await studentLeave(studentA);
      const err = await approve(callers.ct, app.id, {
        granted: { kind: 'PERCENT', value: 10 },
      }).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(code(err).details.code).toBe('GRANTED_NOT_ALLOWED');
      expect((await row(app.id)).status).toBe(ApplicationStatus.PENDING);
    });

    it('approving from UNDER_CONSIDERATION works', async () => {
      const app = await studentLeave(studentA);
      await service.consider(SEED_TENANT_ID, callers.ct, app.id, {}, req);
      const done = await approve(callers.ct, app.id);
      expect(done.status).toBe(ApplicationStatus.APPROVED);
    });
  });

  // --- reject / consider -----------------------------------------------------

  describe('reject and consider', () => {
    it('reject without a reason fails validation (DTO)', async () => {
      const { RejectApplicationDto } = await import('./dto/decide.dto');
      const errors = await validate(plainToInstance(RejectApplicationDto, {}));
      expect(errors.length).toBeGreaterThan(0);
    });

    it('reject at step 0 is final; a later approve is APPLICATION_NOT_OPEN', async () => {
      const app = await testimonial(studentA);
      const rejected = await service.reject(
        SEED_TENANT_ID,
        callers.ct,
        app.id,
        { reason: 'Not eligible' },
        req,
      );
      expect(rejected.status).toBe(ApplicationStatus.REJECTED);
      const ev = (await events(app.id)).find((e) => e.kind === ApplicationEventKind.REJECTED);
      expect(ev).toMatchObject({ step: 0, note: 'Not eligible' });

      const err = await approve(callers.admin, app.id).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(code(err).details.code).toBe('APPLICATION_NOT_OPEN');
    });

    it('consider parks the application without moving the step; twice is a 409', async () => {
      const app = await testimonial(studentA);
      const parked = await service.consider(
        SEED_TENANT_ID,
        callers.ct,
        app.id,
        { note: 'wait' },
        req,
      );
      expect(parked.status).toBe(ApplicationStatus.UNDER_CONSIDERATION);
      expect(parked.current_step).toBe(0);
      expect(notify.onStatusChanged).toHaveBeenCalledTimes(1);

      const err = await service
        .consider(SEED_TENANT_ID, callers.ct, app.id, {}, req)
        .catch((e) => e);
      expect(code(err).details.code).toBe('ALREADY_UNDER_CONSIDERATION');
    });

    it('a viewer who is not a decider (OFFICE_STAFF) cannot reject or consider', async () => {
      const app = await studentLeave(studentA);
      await expect(
        service.reject(SEED_TENANT_ID, callers.office, app.id, { reason: 'x' }, req),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.consider(SEED_TENANT_ID, callers.office, app.id, {}, req),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // --- cancel ----------------------------------------------------------------

  describe('cancel', () => {
    const cancel = (c: ApplicationCaller, id: string) =>
      service.cancel(SEED_TENANT_ID, c, id, { reason: 'Dates changed' }, req);

    it('applicant cannot cancel; PENDING and non-cancellable types are 409 NOT_CANCELLABLE', async () => {
      const staff = await staffLeave(callers.acct);
      await approve(callers.admin, staff.id);
      const own = await cancel(callers.acct, staff.id).catch((e) => e);
      expect(own).toBeInstanceOf(ForbiddenException);
      expect(code(own).details.code).toBe('APPLICANT_CANNOT_CANCEL');

      const pending = await studentLeave(studentA);
      const notYet = await cancel(callers.ct, pending.id).catch((e) => e);
      expect(code(notYet).details.code).toBe('NOT_CANCELLABLE');

      const cert = await testimonial(studentA);
      await approve(callers.admin, cert.id);
      const manual = await cancel(callers.admin, cert.id).catch((e) => e);
      expect(manual).toBeInstanceOf(ConflictException);
      expect(code(manual).details.code).toBe('NOT_CANCELLABLE');
    });

    it('D49: the ADMIN cannot cancel an approved paper leave about their own profile', async () => {
      const app = await paperOwnLeave();
      await approve(callers.exec, app.id);
      const err = await cancel(callers.admin, app.id).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(code(err).details.code).toBe('APPLICANT_CANNOT_CANCEL');
      expect(handlers.staffLeave.cancel).not.toHaveBeenCalled();
      expect((await row(app.id)).status).toBe(ApplicationStatus.APPROVED);
      const listed = await applications.get(SEED_TENANT_ID, callers.admin, app.id);
      expect(listed.can.cancel).toBe(false);
    });

    it('approved STUDENT_LEAVE: class teacher cancels, handler.cancel runs, CANCELLED + event', async () => {
      const app = await studentLeave(studentA);
      await approve(callers.ct, app.id);
      const done = await cancel(callers.ct, app.id);
      expect(done.status).toBe(ApplicationStatus.CANCELLED);
      expect(handlers.studentLeave.cancel).toHaveBeenCalledTimes(1);
      const ev = (await events(app.id)).find((e) => e.kind === ApplicationEventKind.CANCELLED);
      expect(ev?.note).toBe('Dates changed');
    });

    it('a stranger cannot cancel (NOT_A_DECIDER) and the handler is not called', async () => {
      const app = await studentLeave(studentA);
      await approve(callers.ct, app.id);
      const err = await cancel(callers.office, app.id).catch((e) => e);
      expect(code(err).details.code).toBe('NOT_A_DECIDER');
      expect(handlers.studentLeave.cancel).not.toHaveBeenCalled();
    });

    it('STAFF_LEAVE: a LEAVE_APPROVE holder cancels and the handler gets the reason; OFFICE_STAFF cannot', async () => {
      const app = await staffLeave(callers.acct);
      await approve(callers.admin, app.id);
      const err = await cancel(callers.office, app.id).catch((e) => e);
      expect(code(err).details.code).toBe('NOT_A_DECIDER');

      const done = await cancel(callers.exec, app.id);
      expect(done.status).toBe(ApplicationStatus.CANCELLED);
      expect(handlers.staffLeave.cancel).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ reason: 'Dates changed', actorUserId: u.exec }),
      );
    });

    it('an override role (not the class teacher) may cancel an approved STUDENT_LEAVE', async () => {
      const app = await studentLeave(studentA);
      await approve(callers.ct, app.id);
      const done = await cancel(callers.admin, app.id);
      expect(done.status).toBe(ApplicationStatus.CANCELLED);
    });

    it('reject, consider and cancel each write an audit row with old and new status', async () => {
      const a = await studentLeave(studentA);
      await service.reject(SEED_TENANT_ID, callers.ct, a.id, { reason: 'No' }, req);
      const b = await studentLeave(studentA);
      await service.consider(SEED_TENANT_ID, callers.ct, b.id, {}, req);
      const c = await studentLeave(studentA);
      await approve(callers.ct, c.id);
      await cancel(callers.ct, c.id);

      const last = async (id: string) => (await auditRows(id)).at(-1);
      expect(await last(a.id)).toMatchObject({
        old_values: { status: ApplicationStatus.PENDING },
        new_values: { status: ApplicationStatus.REJECTED, event_kind: 'REJECTED' },
      });
      expect(await last(b.id)).toMatchObject({
        new_values: { status: ApplicationStatus.UNDER_CONSIDERATION },
      });
      expect(await last(c.id)).toMatchObject({
        old_values: { status: ApplicationStatus.APPROVED },
        new_values: { status: ApplicationStatus.CANCELLED, event_kind: 'CANCELLED' },
      });
    });

    it('a cancellable type whose handler has no cancel() is a 500, not a silent skip', async () => {
      const app = await studentLeave(studentA);
      await approve(callers.ct, app.id);
      (handlers.studentLeave as { cancel?: unknown }).cancel = undefined;
      try {
        await expect(cancel(callers.ct, app.id)).rejects.toThrow('No cancel handler');
      } finally {
        delete (handlers.studentLeave as { cancel?: unknown }).cancel; // fall back to the prototype
      }
      expect((await row(app.id)).status).toBe(ApplicationStatus.APPROVED);
    });

    it('a handler.cancel failure rolls the cancel back', async () => {
      const app = await studentLeave(studentA);
      await approve(callers.ct, app.id);
      vi.spyOn(handlers.studentLeave, 'cancel').mockRejectedValue(new Error('cannot reverse'));
      await expect(cancel(callers.ct, app.id)).rejects.toThrow('cannot reverse');
      expect((await row(app.id)).status).toBe(ApplicationStatus.APPROVED);
    });
  });

  // --- bulk ------------------------------------------------------------------

  describe('bulkApprove', () => {
    it('per-row results: FEE_WAIVER refused, REJECTED row fails, the good one is approved', async () => {
      const waiver = await feeWaiver(studentA);
      const rejected = await studentLeave(studentA);
      await service.reject(SEED_TENANT_ID, callers.ct, rejected.id, { reason: 'No' }, req);
      const good = await studentLeave(studentA);

      const out = await service.bulkApprove(
        SEED_TENANT_ID,
        callers.ct,
        { ids: [waiver.id, rejected.id, good.id], note: 'OK' },
        req,
      );
      expect(out).toEqual([
        { id: waiver.id, ok: false, error_code: 'NOT_BULK_APPROVABLE' },
        { id: rejected.id, ok: false, error_code: 'APPLICATION_NOT_OPEN' },
        { id: good.id, ok: true },
      ]);
      expect((await row(good.id)).status).toBe(ApplicationStatus.APPROVED);
      expect((await row(waiver.id)).status).toBe(ApplicationStatus.PENDING);
    });

    it('a same-tenant non-viewer gets NOT_FOUND, never NOT_BULK_APPROVABLE', async () => {
      const waiver = await feeWaiver(studentA);
      const out = await service.bulkApprove(
        SEED_TENANT_ID,
        callers.other,
        { ids: [waiver.id] },
        req,
      );
      expect(out).toEqual([{ id: waiver.id, ok: false, error_code: 'NOT_FOUND' }]);
    });

    it('51 ids, duplicates and non-UUIDs fail DTO validation', async () => {
      const bad = async (ids: unknown) =>
        (await validate(plainToInstance(BulkApproveDto, { ids }))).length;
      expect(await bad(Array.from({ length: 51 }, () => randomUUID()))).toBeGreaterThan(0);
      const one = randomUUID();
      expect(await bad([one, one])).toBeGreaterThan(0);
      expect(await bad(['nope'])).toBeGreaterThan(0);
      expect(await bad([])).toBeGreaterThan(0);
    });

    it('a non-HTTP error becomes INTERNAL and does not stop the batch', async () => {
      const a = await studentLeave(studentA);
      const b = await studentLeave(studentA);
      vi.spyOn(handlers.studentLeave, 'apply')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ days: 3 });
      const out = await service.bulkApprove(SEED_TENANT_ID, callers.ct, { ids: [a.id, b.id] }, req);
      expect(out).toEqual([
        { id: a.id, ok: false, error_code: 'INTERNAL' },
        { id: b.id, ok: true },
      ]);
    });
  });

  // --- tenant isolation + notify -------------------------------------------------

  describe('tenant isolation', () => {
    it("another tenant's application is 404 on every decision and NOT_FOUND in bulk", async () => {
      const app = await studentLeave(studentA);
      const t = (fn: Promise<unknown>) => expect(fn).rejects.toBeInstanceOf(NotFoundException);
      await t(service.approve(TENANT_B, bAdmin, app.id, {}, req));
      await t(service.reject(TENANT_B, bAdmin, app.id, { reason: 'x' }, req));
      await t(service.consider(TENANT_B, bAdmin, app.id, {}, req));
      await t(service.cancel(TENANT_B, bAdmin, app.id, { reason: 'x' }, req));

      const out = await service.bulkApprove(TENANT_B, bAdmin, { ids: [app.id] }, req);
      expect(out).toEqual([{ id: app.id, ok: false, error_code: 'NOT_FOUND' }]);
      expect((await row(app.id)).status).toBe(ApplicationStatus.PENDING); // untouched
    });
  });

  describe('visibility before state (auth boundary)', () => {
    it('decide: a same-tenant non-viewer gets 404, not APPLICATION_NOT_OPEN', async () => {
      const app = await studentLeave(studentA);
      await service.reject(SEED_TENANT_ID, callers.ct, app.id, { reason: 'No' }, req);
      // `other` is a teacher with no link to this application and it is no longer open.
      await expect(approve(callers.other, app.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cancel: a same-tenant non-viewer gets 404, not NOT_CANCELLABLE', async () => {
      const app = await studentLeave(studentA); // still PENDING, so not cancellable
      await expect(
        service.cancel(SEED_TENANT_ID, callers.other, app.id, { reason: 'x' }, req),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('notifications', () => {
    it('a throwing notify still returns the committed decision', async () => {
      const app = await studentLeave(studentA);
      vi.spyOn(notify, 'onStatusChanged').mockRejectedValue(new Error('push down'));
      const done = await approve(callers.ct, app.id);
      expect(done.status).toBe(ApplicationStatus.APPROVED);
      expect((await row(app.id)).status).toBe(ApplicationStatus.APPROVED);
    });
  });
});
