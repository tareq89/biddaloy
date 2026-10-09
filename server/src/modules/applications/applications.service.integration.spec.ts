import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
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
  ApplicationAddressee,
  ApplicationEventKind,
  ApplicationSource,
  ApplicationStatus,
  ApplicationType,
  TeacherAssignmentType,
  UserRole,
} from '@biddaloy/shared';
import { AuthModule } from '../auth/auth.module';
import { Teacher } from '../academics/entities/teacher.entity';
import { ApplicationsModule } from './applications.module';
import { ApplicationsService } from './applications.service';
import { ApplicationLetterService } from './application-letter.service';
import { ApplicationNotifyService } from './application-notify.service';
import { ReviewerScopeService, type ApplicationCaller } from './reviewer-scope';
import { Application } from './entities/application.entity';
import { ApplicationTag } from './entities/application-tag.entity';
import type { CreateApplicationDto } from './dto/application.dto';
import { QueryApplicationsDto } from './dto/query-applications.dto';

/**
 * [52.2.1] Integration tests for `ApplicationsService` + `ReviewerScopeService` against the
 * real, migrated test database. The letter and notify services are spied (their real work
 * belongs to 52.2.2 and 52.2.6); everything else (serials, inbox SQL, class-teacher rules,
 * tenant isolation) runs for real.
 *
 * Cast (tenant A unless noted):
 *   parent     PARENT          linked to studentA and studentB
 *   parent2    PARENT          linked to nobody
 *   studentU   STUDENT         is studentA
 *   ct         TEACHER         CLASS_TEACHER of section 1 (studentA's section)
 *   asst       TEACHER         ASSISTANT_CLASS_TEACHER of section 1
 *   other      TEACHER         no assignment
 *   office     OFFICE_STAFF    has APPLICATION_MANAGE
 *   acct       ACCOUNTANT      has a staff profile
 *   exec/admin EXECUTIVE/ADMIN override roles (admin also has a staff profile)
 * studentB sits in section 2, which has no class teacher.
 */
describe('ApplicationsService (integration)', () => {
  let service: ApplicationsService;
  let reviewer: ReviewerScopeService;
  let dataSource: DataSource;
  let letter: ApplicationLetterService;
  let notify: ApplicationNotifyService;

  const TENANT_B = randomUUID();
  const ctx = { ip: null, userAgent: null };

  const u = {
    parent: randomUUID(),
    parent2: randomUUID(),
    studentU: randomUUID(),
    ct: randomUUID(),
    asst: randomUUID(),
    other: randomUUID(),
    office: randomUUID(),
    acct: randomUUID(),
    exec: randomUUID(),
    bAdmin: randomUUID(),
  };
  const callers = {
    parent: { userId: u.parent, role: UserRole.PARENT },
    parent2: { userId: u.parent2, role: UserRole.PARENT },
    studentU: { userId: u.studentU, role: UserRole.STUDENT },
    ct: { userId: u.ct, role: UserRole.TEACHER },
    asst: { userId: u.asst, role: UserRole.TEACHER },
    other: { userId: u.other, role: UserRole.TEACHER },
    office: { userId: u.office, role: UserRole.OFFICE_STAFF },
    acct: { userId: u.acct, role: UserRole.ACCOUNTANT },
    exec: { userId: u.exec, role: UserRole.EXECUTIVE },
    admin: { userId: SEED_ADMIN_USER_ID, role: UserRole.ADMIN },
  } satisfies Record<string, ApplicationCaller>;
  const bAdmin: ApplicationCaller = { userId: u.bAdmin, role: UserRole.ADMIN };

  let studentA: string;
  let studentB: string;
  let studentInB: string;
  let acctProfile: string;
  let sectionInB: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), ApplicationsModule, AuthModule],
    );
    service = module.get(ApplicationsService);
    reviewer = module.get(ReviewerScopeService);
    letter = module.get(ApplicationLetterService);
    notify = module.get(ApplicationNotifyService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    // Users and memberships survive the per-test reset (reference tables), so build them once.
    const members: Array<[string, UserRole]> = [
      [u.parent, UserRole.PARENT],
      [u.parent2, UserRole.PARENT],
      [u.studentU, UserRole.STUDENT],
      [u.ct, UserRole.TEACHER],
      [u.asst, UserRole.TEACHER],
      [u.other, UserRole.TEACHER],
      [u.office, UserRole.OFFICE_STAFF],
      [u.acct, UserRole.ACCOUNTANT],
      [u.exec, UserRole.EXECUTIVE],
    ];
    for (const [id, role] of [...members, [u.bAdmin, UserRole.ADMIN] as [string, UserRole]]) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, `app-${id}@test.com`, SEED_ADMIN_PASSWORD_HASH, `Name ${role} ${id.slice(0, 4)}`],
      );
    }
    for (const [id, role] of members) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
    }

    // Tenant B with its own class and section.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Applications Tenant B', $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B, `applications-b-${TENANT_B.slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'ADMIN', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [u.bAdmin, TENANT_B],
    );
    const yearB = randomUUID();
    const classB = randomUUID();
    sectionInB = randomUUID();
    await dataSource.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, 'B year', '2026-01-01', '2026-12-31', true, $2, NOW(), NOW())`,
      [yearB, TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'B Class', $2, $3, NOW(), NOW())`,
      [classB, yearB, TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'B', $2, $3, NOW(), NOW())`,
      [sectionInB, classB, TENANT_B],
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
    vi.spyOn(notify, 'onTagged').mockResolvedValue();
    vi.spyOn(notify, 'onComment').mockResolvedValue();
    vi.spyOn(notify, 'onStatusChanged').mockResolvedValue();

    // Transactional tables are emptied before every test, so people-with-data are rebuilt here.
    const mkStudent = async (name: string, section: string, tenantId: string, userId?: string) => {
      const rows = await dataSource.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                               user_id, enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
        [
          name,
          `AP-${randomUUID().slice(0, 10)}`,
          Math.floor(Math.random() * 1e6),
          section,
          tenantId,
          userId ?? null,
        ],
      );
      return rows[0].id as string;
    };
    studentA = await mkStudent('Student A', SEED_SECTION_1_ID, SEED_TENANT_ID, u.studentU);
    studentB = await mkStudent('Student B', SEED_SECTION_2_ID, SEED_TENANT_ID);
    studentInB = await mkStudent('Student In B', sectionInB, TENANT_B);

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

    // Teachers: ct = class teacher, asst = assistant, other = no section. Saving a Teacher also
    // creates its staff profile (TeacherStaffProfileSubscriber).
    const teacherRepo = dataSource.getRepository(Teacher);
    const mkTeacher = async (userId: string) =>
      (
        await teacherRepo.save({
          user_id: userId,
          tenant_id: SEED_TENANT_ID,
          employee_id: `AP-${randomUUID().slice(0, 12)}`,
          designations: [],
        })
      ).id;
    const assign = (teacherId: string, type: TeacherAssignmentType) =>
      dataSource.query(
        `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [teacherId, SEED_SECTION_1_ID, SEED_TENANT_ID, type],
      );
    await assign(await mkTeacher(u.ct), TeacherAssignmentType.CLASS_TEACHER);
    await assign(await mkTeacher(u.asst), TeacherAssignmentType.ASSISTANT_CLASS_TEACHER);
    await mkTeacher(u.other);

    // Staff profiles for the two non-teacher staff who file their own applications.
    const mkProfile = async (userId: string) =>
      (
        await dataSource.query(
          `INSERT INTO staff_profiles (user_id, tenant_id, employee_id, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
          [userId, SEED_TENANT_ID, `AP-${randomUUID().slice(0, 12)}`],
        )
      )[0].id as string;
    acctProfile = await mkProfile(u.acct);
    await mkProfile(SEED_ADMIN_USER_ID);
  });

  // --- helpers -------------------------------------------------------------

  const leavePayload = {
    reason_kind: 'SICK',
    start_date: '2026-10-12',
    end_date: '2026-10-14',
    details: 'Fever, doctor advised rest',
  };
  const studentLeave = (
    student: string,
    over: Partial<CreateApplicationDto> = {},
  ): CreateApplicationDto => ({
    type: ApplicationType.STUDENT_LEAVE,
    subject_student_id: student,
    payload: { ...leavePayload },
    ...over,
  });
  const staffLeave = (over: Partial<CreateApplicationDto> = {}): CreateApplicationDto => ({
    type: ApplicationType.STAFF_LEAVE,
    payload: {
      leave_type: 'CASUAL',
      start_date: '2026-10-12',
      end_date: '2026-10-13',
      reason: 'Family event',
    },
    ...over,
  });
  const general = (over: Partial<CreateApplicationDto> = {}): CreateApplicationDto => ({
    type: ApplicationType.GENERAL,
    payload: { subject_line: 'Request', body: 'Please consider this request.' },
    ...over,
  });
  const submit = (c: ApplicationCaller, dto: CreateApplicationDto, tenantId = SEED_TENANT_ID) =>
    service.submit(tenantId, c, dto, ctx);
  const entity = (id: string) => dataSource.getRepository(Application).findOneByOrFail({ id });
  const inboxIds = async (c: ApplicationCaller) =>
    (await service.list(SEED_TENANT_ID, c, { view: 'inbox', limit: 100 })).data.map((r) => r.id);

  // --- submit --------------------------------------------------------------

  describe('submit', () => {
    it('linked PARENT files STUDENT_LEAVE: PENDING, serial 1, SUBMITTED event, notified once', async () => {
      const first = await submit(callers.parent, studentLeave(studentA));
      const second = await submit(callers.parent, studentLeave(studentA));

      expect(first.status).toBe(ApplicationStatus.PENDING);
      expect(first.source).toBe(ApplicationSource.APP);
      expect(first.serial_no).toBe(1);
      expect(second.serial_no).toBe(2); // n + 1
      expect(first.events.map((e) => e.kind)).toEqual([ApplicationEventKind.SUBMITTED]);
      expect(first.letter_text).toBe('x');
      expect(first.letter_locale).toBe('en');
      expect(notify.onSubmitted).toHaveBeenCalledTimes(2);
      expect(first.subject_name).toBe('Student A');
      expect(first.can.withdraw).toBe(true);
    });

    it('a notify failure never fails the submit', async () => {
      vi.spyOn(notify, 'onSubmitted').mockRejectedValue(new Error('push down'));
      const app = await submit(callers.parent, studentLeave(studentA));
      expect(app.status).toBe(ApplicationStatus.PENDING);
    });

    it('serial is "YYYY/0001" with Latin digits even for a Bangla school (D47)', async () => {
      vi.spyOn(letter, 'buildContext').mockResolvedValue({
        locale: 'bn',
        date: '',
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
      const app = await submit(callers.parent, studentLeave(studentA));
      expect(app.serial).toMatch(/^\d{4}\/0001$/);
      expect(app.letter_locale).toBe('bn');
      // The letter gets the same serial string the row stores.
      expect(letter.buildContext).toHaveBeenCalledWith(
        expect.anything(),
        SEED_TENANT_ID,
        expect.objectContaining({ serial: app.serial }),
      );
    });

    it('two concurrent submits in one tenant get two different serials', async () => {
      const [a, b] = await Promise.all([
        submit(callers.parent, studentLeave(studentA)),
        submit(callers.parent, studentLeave(studentB)),
      ]);
      expect([a.serial_no, b.serial_no].sort()).toEqual([1, 2]);
    });

    it('serials are per tenant: tenant B starts at 1', async () => {
      await submit(callers.parent, studentLeave(studentA));
      const inB = await submit(
        bAdmin,
        { ...studentLeave(studentInB), applicant_name: 'Abdul Karim' },
        TENANT_B,
      );
      expect(inB.serial_no).toBe(1);
    });

    it('refuses a PARENT for an unlinked student, a STUDENT for another student, a TEACHER without on-behalf', async () => {
      await expect(submit(callers.parent2, studentLeave(studentA))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(submit(callers.studentU, studentLeave(studentB))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(submit(callers.ct, studentLeave(studentA))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      // A STUDENT may file for themself.
      const own = await submit(callers.studentU, studentLeave(studentA));
      expect(own.applicant_role).toBe(UserRole.STUDENT);
    });

    it('OFFICE_STAFF on behalf: PAPER, entered_by set; applicant_name only keeps a null applicant (D46)', async () => {
      const withUser = await submit(
        callers.office,
        studentLeave(studentA, { on_behalf_of_user_id: u.parent }),
      );
      expect(withUser.source).toBe(ApplicationSource.PAPER);
      expect(withUser.entered_by_user_id).toBe(u.office);
      expect(withUser.applicant_user_id).toBe(u.parent);

      const nameOnly = await submit(
        callers.office,
        studentLeave(studentA, { applicant_name: 'Abdul Karim' }),
      );
      expect(nameOnly.applicant_user_id).toBeNull();
      expect(nameOnly.applicant_name).toBe('Abdul Karim');

      await expect(
        submit(
          callers.office,
          studentLeave(studentA, { on_behalf_of_user_id: u.parent, applicant_name: 'X' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // A TEACHER lacks APPLICATION_MANAGE.
      await expect(
        submit(callers.ct, studentLeave(studentA, { applicant_name: 'Abdul Karim' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // The named applicant must be linked to the subject like a real submitter.
      await expect(
        submit(callers.office, studentLeave(studentA, { on_behalf_of_user_id: u.parent2 })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rejects a bad payload, a backwards date range, and a section from another tenant', async () => {
      const noEnd = studentLeave(studentA, { payload: { ...leavePayload, end_date: undefined } });
      await expect(submit(callers.parent, noEnd)).rejects.toBeInstanceOf(BadRequestException);
      const extra = studentLeave(studentA, { payload: { ...leavePayload, sneaky: 1 } });
      await expect(submit(callers.parent, extra)).rejects.toBeInstanceOf(BadRequestException);
      const backwards = studentLeave(studentA, {
        payload: { ...leavePayload, start_date: '2026-10-14', end_date: '2026-10-12' },
      });
      await expect(submit(callers.parent, backwards)).rejects.toBeInstanceOf(BadRequestException);

      const foreignSection: CreateApplicationDto = {
        type: ApplicationType.SECTION_CHANGE,
        subject_student_id: studentA,
        applicant_name: 'Abdul Karim',
        payload: { to_section_id: sectionInB, reason: 'Closer to home' },
      };
      await expect(submit(callers.office, foreignSection)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      const ownSection = {
        ...foreignSection,
        payload: { to_section_id: SEED_SECTION_2_ID, reason: 'Closer to home' },
      };
      const ok = await submit(callers.office, ownSection);
      expect(ok.ref_names.to_section_id).toBeTruthy();
    });

    it('STAFF_LEAVE and STUDENT_LEAVE with end before start are a 400, before any working-day maths', async () => {
      const payload = {
        leave_type: 'CASUAL',
        start_date: '2026-10-14',
        end_date: '2026-10-12',
        reason: 'Family event',
      };
      await expect(submit(callers.acct, staffLeave({ payload }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('GENERAL with no addressee is a 422, for staff and for family', async () => {
      await expect(submit(callers.acct, general())).rejects.toMatchObject({
        response: { details: { code: 'APPLICATION_ADDRESSEE_INVALID' } },
      });
      await expect(
        submit(callers.parent, general({ subject_student_id: studentA })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('skips a leading class-teacher step only when the student has none (never the last step)', async () => {
      const feeWaiver = (student: string): CreateApplicationDto => ({
        type: ApplicationType.FEE_WAIVER,
        subject_student_id: student,
        applicant_name: 'Abdul Karim',
        payload: { kind: 'PERCENT', value: 25, reason: 'Hardship in the family' },
      });
      const withTeacher = await submit(callers.office, feeWaiver(studentA));
      expect(withTeacher.current_step).toBe(0);

      const noTeacher = await submit(callers.office, feeWaiver(studentB));
      expect(noTeacher.current_step).toBe(1);
      expect(noTeacher.events[0].data).toEqual({ skipped_steps: [0] });

      // STUDENT_LEAVE has one step, which is the class-teacher step: it stays.
      const leave = await submit(
        callers.office,
        studentLeave(studentB, { applicant_name: 'Abdul Karim' }),
      );
      expect(leave.current_step).toBe(0);

      const tooBig = {
        ...feeWaiver(studentA),
        payload: { kind: 'PERCENT', value: 120, reason: 'Too much' },
      };
      await expect(submit(callers.office, tooBig)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('STAFF_LEAVE defaults the subject to the caller and copies the dates; another profile is refused', async () => {
      const app = await submit(callers.acct, staffLeave());
      expect(app.subject_staff_profile_id).toBe(acctProfile);
      expect(app.start_date).toBe('2026-10-12');
      expect(app.end_date).toBe('2026-10-13');
      await expect(
        submit(callers.ct, staffLeave({ subject_staff_profile_id: acctProfile })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // A student type with a staff subject does not match.
      await expect(
        submit(
          callers.acct,
          studentLeave(studentA, {
            subject_student_id: undefined,
            subject_staff_profile_id: acctProfile,
          }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  // --- GENERAL addressee + tags --------------------------------------------

  describe('addressee and tags', () => {
    it('GENERAL: staff must use STAFF_USER with an active staff user; family picks class teacher / headmaster / office', async () => {
      await expect(
        submit(callers.acct, general({ addressee: ApplicationAddressee.HEADMASTER })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(
        submit(
          callers.acct,
          general({ addressee: ApplicationAddressee.STAFF_USER, addressee_user_id: u.parent }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      const ok = await submit(
        callers.acct,
        general({ addressee: ApplicationAddressee.STAFF_USER, addressee_user_id: u.ct }),
      );
      expect(ok.addressee_user_id).toBe(u.ct);
      expect(ok.addressee_name).toBeTruthy();

      const fam = await submit(
        callers.parent,
        general({ subject_student_id: studentA, addressee: ApplicationAddressee.CLASS_TEACHER }),
      );
      expect(fam.addressee).toBe(ApplicationAddressee.CLASS_TEACHER);
      // studentB's section has no class teacher right now.
      await expect(
        submit(
          callers.parent,
          general({ subject_student_id: studentB, addressee: ApplicationAddressee.CLASS_TEACHER }),
        ),
      ).rejects.toMatchObject({ response: { details: { code: 'APPLICATION_NO_CLASS_TEACHER' } } });
      // An addressee on a typed application is refused.
      await expect(
        submit(callers.parent, studentLeave(studentA, { addressee: ApplicationAddressee.OFFICE })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('tags: a PARENT user or a COMMITTEE role is refused; the same role twice is one row; guardians cannot tag', async () => {
      await expect(
        submit(
          callers.office,
          studentLeave(studentA, { applicant_name: 'X Y', tags: [{ user_id: u.parent }] }),
        ),
      ).rejects.toMatchObject({ response: { details: { code: 'APPLICATION_TAG_INVALID' } } });
      await expect(
        submit(
          callers.office,
          studentLeave(studentA, { applicant_name: 'X Y', tags: [{ role: UserRole.COMMITTEE }] }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      const app = await submit(
        callers.office,
        studentLeave(studentA, {
          applicant_name: 'X Y',
          tags: [{ role: UserRole.TEACHER }, { role: UserRole.TEACHER }],
        }),
      );
      expect(app.tags).toHaveLength(1);
      expect(app.events.map((e) => e.kind)).toEqual([
        ApplicationEventKind.SUBMITTED,
        ApplicationEventKind.TAGGED,
      ]);
      expect(notify.onTagged).toHaveBeenCalledTimes(1);

      // Tagging the same role again changes nothing.
      const again = await service.addTags(SEED_TENANT_ID, callers.office, app.id, [
        { role: UserRole.TEACHER },
      ]);
      expect(again.tags).toHaveLength(1);
      expect(
        await dataSource.getRepository(ApplicationTag).countBy({ application_id: app.id }),
      ).toBe(1);

      // D50: a guardian's submit with tags is a 400.
      await expect(
        submit(callers.parent, studentLeave(studentA, { tags: [{ role: UserRole.OFFICE_STAFF }] })),
      ).rejects.toMatchObject({ response: { details: { code: 'APPLICATION_TAGS_STAFF_ONLY' } } });
    });

    it('tag a person by user id; only the applicant, a decider or APPLICATION_MANAGE may add tags', async () => {
      const app = await submit(callers.parent, studentLeave(studentA));
      await expect(
        service.addTags(SEED_TENANT_ID, callers.other, app.id, [{ user_id: u.ct }]),
      ).rejects.toBeInstanceOf(NotFoundException);
      const tagged = await service.addTags(SEED_TENANT_ID, callers.ct, app.id, [
        { user_id: u.other },
      ]);
      expect(tagged.tags.map((t) => t.user_id)).toEqual([u.other]);
      expect(tagged.tags[0].user_name).toBeTruthy();
      // The tagged person can now see it.
      expect((await service.get(SEED_TENANT_ID, callers.other, app.id)).id).toBe(app.id);
    });
  });

  // --- inbox ---------------------------------------------------------------

  describe('inbox and canDecide', () => {
    it('the class teacher sees their section; assistant, other teacher and the applicant do not', async () => {
      const app = await submit(callers.parent, studentLeave(studentA));
      expect(await inboxIds(callers.ct)).toContain(app.id);
      expect(await inboxIds(callers.asst)).not.toContain(app.id);
      expect(await inboxIds(callers.other)).not.toContain(app.id);
      expect(await inboxIds(callers.parent)).not.toContain(app.id);
      const row = (await service.list(SEED_TENANT_ID, callers.ct, { view: 'inbox' })).data[0];
      expect(row.can.decide).toBe(true);
    });

    it('ADMIN and EXECUTIVE see a STAFF_LEAVE (LEAVE_APPROVE); a paper application with no applicant still reaches the class teacher', async () => {
      const leave = await submit(callers.acct, staffLeave());
      expect(await inboxIds(callers.admin)).toContain(leave.id);
      expect(await inboxIds(callers.exec)).toContain(leave.id);
      expect(await inboxIds(callers.acct)).not.toContain(leave.id);

      const paper = await submit(
        callers.office,
        studentLeave(studentA, { applicant_name: 'Abdul Karim' }),
      );
      expect(paper.applicant_user_id).toBeNull();
      expect(await inboxIds(callers.ct)).toContain(paper.id);
    });

    it('nobody decides their own application, not even an override role (D49)', async () => {
      const own = await submit(callers.admin, staffLeave());
      expect(await inboxIds(callers.admin)).not.toContain(own.id);
      expect(
        await reviewer.canDecide(dataSource.manager, callers.admin, await entity(own.id)),
      ).toBe(false);
      // Another override role may decide it.
      expect(
        await reviewer.canDecide(dataSource.manager, callers.exec, await entity(own.id)),
      ).toBeTruthy();
    });

    it('applyInbox and canDecide agree for every row and every non-override caller; override inboxes are a subset (D49)', async () => {
      const feeWaiver = (student: string): CreateApplicationDto => ({
        type: ApplicationType.FEE_WAIVER,
        subject_student_id: student,
        applicant_name: 'Abdul Karim',
        payload: { kind: 'FLAT', value: 500, reason: 'Hardship in the family' },
      });
      const ids = [
        (await submit(callers.parent, studentLeave(studentA))).id,
        (await submit(callers.office, studentLeave(studentB, { applicant_name: 'No Teacher' }))).id, // orphan step
        (await submit(callers.office, feeWaiver(studentA))).id,
        (await submit(callers.office, feeWaiver(studentB))).id,
        (await submit(callers.acct, staffLeave())).id,
        (
          await submit(
            callers.acct,
            general({ addressee: ApplicationAddressee.STAFF_USER, addressee_user_id: u.ct }),
          )
        ).id,
        (
          await submit(
            callers.parent,
            general({ subject_student_id: studentA, addressee: ApplicationAddressee.HEADMASTER }),
          )
        ).id,
        (
          await submit(
            callers.parent,
            general({
              subject_student_id: studentA,
              addressee: ApplicationAddressee.CLASS_TEACHER,
            }),
          )
        ).id,
        (
          await submit(callers.parent, {
            type: ApplicationType.ID_CARD_REPRINT,
            subject_student_id: studentA,
            payload: { reason: 'Lost the card' },
          })
        ).id,
        (
          await submit(callers.office, {
            type: ApplicationType.SECTION_CHANGE,
            subject_student_id: studentA,
            applicant_name: 'Abdul',
            payload: { to_section_id: SEED_SECTION_2_ID, reason: 'Closer' },
          })
        ).id,
      ];
      const apps = await Promise.all(ids.map(entity));

      for (const [name, caller] of Object.entries(callers)) {
        const inbox = new Set(await inboxIds(caller));
        const override = name === 'admin' || name === 'exec';
        for (const app of apps) {
          const decision = await reviewer.canDecide(dataSource.manager, caller, app);
          if (override) {
            // Everything in an override inbox is something they may decide.
            if (inbox.has(app.id)) expect(decision, `${name} ${app.type}`).toBeTruthy();
          } else {
            expect(inbox.has(app.id), `${name} ${app.type} step ${app.current_step}`).toBe(
              decision === 'STEP',
            );
          }
        }
      }
      // The STUDENT_LEAVE in a section with no class teacher is in the override inbox.
      expect(await inboxIds(callers.admin)).toContain(ids[1]);
      expect(await inboxIds(callers.exec)).toContain(ids[1]);
    });

    it('a GENERAL addressed to the class teacher whose section lost its class teacher is in the override inbox, and canDecide agrees', async () => {
      const app = await submit(
        callers.parent,
        general({ subject_student_id: studentA, addressee: ApplicationAddressee.CLASS_TEACHER }),
      );
      // A live class teacher still owns it.
      for (const caller of [callers.admin, callers.exec]) {
        expect(await inboxIds(caller)).not.toContain(app.id);
      }
      await dataSource.query(
        `DELETE FROM teacher_class_sections WHERE section_id = $1 AND assignment_type = 'CLASS_TEACHER'`,
        [SEED_SECTION_1_ID],
      );
      for (const caller of [callers.admin, callers.exec]) {
        expect(await inboxIds(caller)).toContain(app.id);
        expect(await reviewer.canDecide(dataSource.manager, caller, await entity(app.id))).toBe(
          'OVERRIDE',
        );
      }
      expect(await inboxIds(callers.other)).not.toContain(app.id);
    });

    it('currentDeciderUserIds lists the class teacher, and falls back to override roles when there is none', async () => {
      const withTeacher = await submit(callers.parent, studentLeave(studentA));
      expect(
        await reviewer.currentDeciderUserIds(dataSource.manager, await entity(withTeacher.id)),
      ).toEqual([u.ct]);

      const orphan = await submit(
        callers.office,
        studentLeave(studentB, { applicant_name: 'No Teacher' }),
      );
      const deciders = await reviewer.currentDeciderUserIds(
        dataSource.manager,
        await entity(orphan.id),
      );
      expect(deciders).toEqual(expect.arrayContaining([u.exec, SEED_ADMIN_USER_ID]));
      expect(deciders).not.toContain(u.ct);
    });
  });

  // --- list ----------------------------------------------------------------

  describe('list', () => {
    it('returns the paged shape with a can block per row, and guardian "mine" includes what the student filed (D43)', async () => {
      await submit(callers.studentU, studentLeave(studentA));
      await submit(callers.parent, studentLeave(studentB));
      const res = await service.list(SEED_TENANT_ID, callers.parent, {});
      expect(res).toMatchObject({ total: 2, page: 1, limit: 20, totalPages: 1 });
      expect(res.data).toHaveLength(2);
      for (const row of res.data) expect(row.can).toBeDefined();
      expect(res.data.map((r) => r.applicant_role)).toContain(UserRole.STUDENT);
    });

    it('view=all needs APPLICATION_MANAGE; limit 101 is a 400; filters and q work', async () => {
      const a = await submit(callers.parent, studentLeave(studentA));
      await submit(callers.parent, studentLeave(studentB));

      await expect(
        service.list(SEED_TENANT_ID, callers.ct, { view: 'all' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.list(SEED_TENANT_ID, callers.office, { view: 'all', limit: 101 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      // The DTO rejects it before it ever reaches the service.
      const dto = plainToInstance(QueryApplicationsDto, { limit: '101' });
      expect((await validate(dto)).length).toBeGreaterThan(0);

      const all = await service.list(SEED_TENANT_ID, callers.office, { view: 'all' });
      expect(all.total).toBe(2);
      const byStudent = await service.list(SEED_TENANT_ID, callers.office, {
        view: 'all',
        student_id: studentA,
      });
      expect(byStudent.data.map((r) => r.id)).toEqual([a.id]);
      const byName = await service.list(SEED_TENANT_ID, callers.office, {
        view: 'all',
        q: 'student b',
      });
      expect(byName.total).toBe(1);
      const bySerial = await service.list(SEED_TENANT_ID, callers.office, {
        view: 'all',
        q: `${a.serial_year}/${a.serial_no}`,
      });
      expect(bySerial.data.map((r) => r.id)).toEqual([a.id]);
      const paged = await service.list(SEED_TENANT_ID, callers.office, {
        view: 'all',
        limit: 1,
        page: 2,
      });
      expect(paged).toMatchObject({ total: 2, page: 2, limit: 1, totalPages: 2 });
      expect(paged.data).toHaveLength(1);
    });
  });

  // --- get / withdraw / comment --------------------------------------------

  describe('get, withdraw, comment', () => {
    it('get: an unrelated TEACHER gets 404; a tagged role gets 200; can.withdraw is the applicant only', async () => {
      const app = await submit(
        callers.office,
        studentLeave(studentA, {
          on_behalf_of_user_id: u.parent,
          tags: [{ role: UserRole.TEACHER }],
        }),
      );
      // `other` holds the tagged TEACHER role, so can view; an untagged role cannot.
      expect((await service.get(SEED_TENANT_ID, callers.other, app.id)).id).toBe(app.id);
      await expect(service.get(SEED_TENANT_ID, callers.parent2, app.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.get(SEED_TENANT_ID, callers.acct, app.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect((await service.get(SEED_TENANT_ID, callers.parent, app.id)).can.withdraw).toBe(true);
      expect((await service.get(SEED_TENANT_ID, callers.ct, app.id)).can.withdraw).toBe(false);
      expect((await service.get(SEED_TENANT_ID, callers.ct, app.id)).can.decide).toBe(true);
    });

    it('get: a linked guardian sees it; a tenant-B caller gets 404 on a tenant-A id', async () => {
      const app = await submit(callers.studentU, studentLeave(studentA));
      expect((await service.get(SEED_TENANT_ID, callers.parent, app.id)).id).toBe(app.id);
      await expect(service.get(TENANT_B, bAdmin, app.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('withdraw: only the applicant (403), once (422), and it notifies', async () => {
      const app = await submit(callers.parent, studentLeave(studentA));
      await expect(
        service.withdraw(SEED_TENANT_ID, callers.ct, app.id, ctx),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const done = await service.withdraw(SEED_TENANT_ID, callers.parent, app.id, ctx);
      expect(done.status).toBe(ApplicationStatus.WITHDRAWN);
      expect(done.events.map((e) => e.kind)).toEqual([
        ApplicationEventKind.SUBMITTED,
        ApplicationEventKind.WITHDRAWN,
      ]);
      expect(done.can.withdraw).toBe(false);
      expect(notify.onStatusChanged).toHaveBeenCalledTimes(1);

      await expect(
        service.withdraw(SEED_TENANT_ID, callers.parent, app.id, ctx),
      ).rejects.toMatchObject({
        response: { details: { code: 'APPLICATION_NOT_PENDING' } },
      });
      // A withdrawn application leaves the class teacher's inbox.
      expect(await inboxIds(callers.ct)).not.toContain(app.id);
    });

    it('comment: viewers can; a stranger gets 404; the event carries the note and notifies', async () => {
      const app = await submit(callers.parent, studentLeave(studentA));
      const event = await service.comment(
        SEED_TENANT_ID,
        callers.parent,
        app.id,
        'Prescription attached.',
      );
      expect(event).toMatchObject({
        kind: ApplicationEventKind.COMMENT,
        note: 'Prescription attached.',
        step: 0,
      });
      expect(event.actor_name).toBeTruthy();
      expect(notify.onComment).toHaveBeenCalledTimes(1);
      await expect(
        service.comment(SEED_TENANT_ID, callers.parent2, app.id, 'hi'),
      ).rejects.toBeInstanceOf(NotFoundException);
      const detail = await service.get(SEED_TENANT_ID, callers.ct, app.id);
      expect(detail.events.map((e) => e.kind)).toEqual([
        ApplicationEventKind.SUBMITTED,
        ApplicationEventKind.COMMENT,
      ]);
    });
  });

  // --- pickers + preview ---------------------------------------------------

  describe('addressees, tag options, letter preview', () => {
    it('addressees: family gets class teacher + headmaster + office; staff get staff users', async () => {
      const family = await service.addressees(SEED_TENANT_ID, callers.parent, studentA);
      expect(family.map((o) => o.addressee)).toEqual([
        ApplicationAddressee.CLASS_TEACHER,
        ApplicationAddressee.HEADMASTER,
        ApplicationAddressee.OFFICE,
      ]);
      expect(family[0].user?.id).toBe(u.ct);
      // No class teacher for studentB, and an unlinked parent gets no teacher at all.
      expect(
        (await service.addressees(SEED_TENANT_ID, callers.parent, studentB)).map(
          (o) => o.addressee,
        ),
      ).toEqual([ApplicationAddressee.HEADMASTER, ApplicationAddressee.OFFICE]);
      expect(await service.addressees(SEED_TENANT_ID, callers.parent2, studentA)).toHaveLength(2);

      const staff = await service.addressees(SEED_TENANT_ID, callers.acct);
      expect(staff.every((o) => o.addressee === ApplicationAddressee.STAFF_USER)).toBe(true);
      expect(staff.map((o) => o.user?.id)).toContain(u.ct);
      expect(staff.map((o) => o.user?.id)).not.toContain(u.acct); // not yourself
      expect(staff.map((o) => o.user?.id)).not.toContain(u.parent);
    });

    it('tagOptions: staff only, filtered by name, and the role list excludes SUPER_ADMIN/COMMITTEE', async () => {
      const opts = await service.tagOptions(SEED_TENANT_ID, u.ct.slice(0, 4));
      expect(opts.users.map((x) => x.id)).toContain(u.ct);
      expect(opts.users.map((x) => x.id)).not.toContain(u.parent);
      expect(opts.roles).toContain(UserRole.TEACHER);
      expect(opts.roles).not.toContain(UserRole.SUPER_ADMIN);
      expect(opts.roles).not.toContain(UserRole.COMMITTEE);
    });

    it('letterPreview returns the render output and writes nothing; a bad payload is a 400', async () => {
      vi.spyOn(letter, 'render').mockReturnValue('preview text');
      const before = await dataSource.getRepository(Application).count();
      const res = await service.letterPreview(
        SEED_TENANT_ID,
        callers.parent,
        studentLeave(studentA),
      );
      expect(res).toEqual({ letter_text: 'preview text', letter_locale: 'en' });
      expect(await dataSource.getRepository(Application).count()).toBe(before);
      expect(letter.buildContext).toHaveBeenCalledWith(
        expect.anything(),
        SEED_TENANT_ID,
        expect.objectContaining({ serial: null }),
      );

      const bad = studentLeave(studentA, { payload: { ...leavePayload, end_date: undefined } });
      await expect(
        service.letterPreview(SEED_TENANT_ID, callers.parent, bad),
      ).rejects.toBeInstanceOf(BadRequestException);
      // The same subject rules apply: an unlinked parent cannot preview.
      await expect(
        service.letterPreview(SEED_TENANT_ID, callers.parent2, studentLeave(studentA)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
