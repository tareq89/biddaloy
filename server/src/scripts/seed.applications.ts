import { Not, type EntityManager, type Repository } from 'typeorm';
import {
  ApplicationAddressee,
  ApplicationEventKind,
  ApplicationStatus,
  ApplicationType,
  UserRole,
} from '@biddaloy/shared';
import type { ClassSection } from '../modules/academics/entities/class-section.entity';
import type { Subject } from '../modules/academics/entities/subject.entity';
import type { Exam } from '../modules/exams/entities/exam.entity';
import type { Application } from '../modules/applications/entities/application.entity';
import type {
  ApplicationDto,
  ApplicationTagInput,
  CreateApplicationDto,
} from '../modules/applications/dto/application.dto';
import type { ApplicationCaller } from '../modules/applications/reviewer-scope';
import type { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import type { StaffProfile } from '../modules/staff-profiles/entities/staff-profile.entity';
import type { Guardian } from '../modules/students/entities/guardian.entity';
import type { User } from '../modules/users/entities/user.entity';
import { DEMO_ACADEMIC_YEAR } from './seed.util';

// Kept out of seed.ts on purpose (same reason as seed.lifecycle.ts): this file
// must not import anything that reaches AppModule.

/** The real `ApplicationsService` calls, handed in by `seed.ts` so serials, letters and events are the API's own. */
export interface ApplicationsSeedPorts {
  submit(
    tenantId: string,
    user: ApplicationCaller,
    dto: CreateApplicationDto,
  ): Promise<ApplicationDto>;
  comment(tenantId: string, user: ApplicationCaller, id: string, note: string): Promise<unknown>;
  addTags(
    tenantId: string,
    user: ApplicationCaller,
    id: string,
    tags: ApplicationTagInput[],
  ): Promise<unknown>;
}

export interface ApplicationsSeedRepositories {
  applicationRepository: Repository<Application>;
  staffProfileRepository: Repository<StaffProfile>;
  guardianRepository: Repository<Guardian>;
  userRepository: Repository<User>;
  userTenantRepository: Repository<UserTenant>;
  classSectionRepository: Repository<ClassSection>;
  examRepository: Repository<Exam>;
  subjectRepository: Repository<Subject>;
}

const PARENT_EMAIL = 'parent@biddaloy.test';
const TEACHER_EMAIL = 'teacher@biddaloy.test';
const OFFICE_EMAIL = 'office@biddaloy.test';

/**
 * [52.2.7] One PENDING application per type (10), two PAPER ones, two tags and a comment, all
 * filed through the real service. Dates are fixed inside `DEMO_ACADEMIC_YEAR`, never "today",
 * and the staff leave (24-25 March) must not overlap the approved demo leave of 10-11 March.
 * Idempotent: skips when the tenant already has any application.
 */
export async function ensureApplicationsSeed(
  repos: ApplicationsSeedRepositories,
  ports: ApplicationsSeedPorts,
  tenantId: string,
  adminUserId: string,
): Promise<void> {
  if ((await repos.applicationRepository.count({ where: { tenant_id: tenantId } })) > 0) {
    console.log('Applications already seeded — skipping.');
    await ensureDecidedApplicationsSeed(repos, tenantId, adminUserId);
    return;
  }
  // The staff filer is the demo teacher, not "the first profile" (that one is the admin).
  const teacherUser = await repos.userRepository.findOne({ where: { email: TEACHER_EMAIL } });
  const staff = teacherUser
    ? await repos.staffProfileRepository.findOne({
        where: { tenant_id: tenantId, user_id: teacherUser.id },
      })
    : null;
  const guardian = await repos.guardianRepository.findOne({
    where: { tenant_id: tenantId, user: { email: PARENT_EMAIL } },
    relations: { students: true },
  });
  const student = guardian?.students?.[0];
  const office = await repos.userRepository.findOne({ where: { email: OFFICE_EMAIL } });
  const staffTenant = staff
    ? await repos.userTenantRepository.findOne({
        where: { tenant_id: tenantId, user_id: staff.user_id },
      })
    : null;
  const sections = await repos.classSectionRepository.find({ where: { tenant_id: tenantId } });
  const otherSection = sections.find((s) => s.id !== student?.class_section_id);
  const exam = await repos.examRepository.findOne({ where: { tenant_id: tenantId } });
  const subject = await repos.subjectRepository.findOne({ where: { tenant_id: tenantId } });
  if (
    !staff ||
    !staffTenant ||
    !guardian?.user_id ||
    !student ||
    !office ||
    !otherSection ||
    !exam ||
    !subject
  ) {
    console.warn(
      'Demo staff/parent/student/office/section/exam not found — skipping applications seed.',
    );
    return;
  }

  const parent: ApplicationCaller = { userId: guardian.user_id, role: UserRole.PARENT };
  const teacher: ApplicationCaller = { userId: staff.user_id, role: staffTenant.role };
  const officeCaller: ApplicationCaller = { userId: office.id, role: UserRole.OFFICE_STAFF };
  const admin: ApplicationCaller = { userId: adminUserId, role: UserRole.ADMIN };
  const file = (caller: ApplicationCaller, dto: CreateApplicationDto) =>
    ports.submit(tenantId, caller, dto);
  const forStudent = (
    type: ApplicationType,
    payload: Record<string, unknown>,
  ): CreateApplicationDto => ({ type, subject_student_id: student.id, payload });

  await file(teacher, {
    type: ApplicationType.STAFF_LEAVE,
    payload: {
      leave_type: 'CASUAL',
      start_date: '2026-03-24',
      end_date: '2026-03-25',
      reason: 'পারিবারিক কাজ',
    },
  });
  const studentLeave = await file(
    parent,
    forStudent(ApplicationType.STUDENT_LEAVE, {
      reason_kind: 'SICK',
      start_date: '2026-03-04',
      end_date: '2026-03-05',
      details: 'জ্বর',
    }),
  );
  await file(
    parent,
    forStudent(ApplicationType.FEE_WAIVER, { kind: 'FLAT', value: 500, reason: 'আর্থিক অসুবিধা' }),
  );
  await file(parent, forStudent(ApplicationType.TESTIMONIAL, { purpose: 'বৃত্তির আবেদন' }));
  await file(
    parent,
    forStudent(ApplicationType.TRANSFER_CERTIFICATE, {
      leaving_date: '2026-12-15',
      destination: 'ঢাকা',
      reason: 'বদলি',
    }),
  );
  await file(
    parent,
    forStudent(ApplicationType.READMISSION, {
      class_section_id: student.class_section_id,
      occurred_on: '2026-06-01',
      reason: 'পুনরায় ভর্তি হতে চাই',
    }),
  );
  await file(
    parent,
    forStudent(ApplicationType.SECTION_CHANGE, {
      to_section_id: otherSection.id,
      reason: 'বাড়ির কাছে',
    }),
  );
  await file(
    parent,
    forStudent(ApplicationType.SCRIPT_RECHECK, {
      exam_id: exam.id,
      subject_id: subject.id,
      reason: 'নম্বর পুনর্মূল্যায়ন চাই',
    }),
  );
  const idCard = await file(
    parent,
    forStudent(ApplicationType.ID_CARD_REPRINT, { reason: 'কার্ড হারিয়ে গেছে' }),
  );
  const general = await file(parent, {
    ...forStudent(ApplicationType.GENERAL, {
      subject_line: 'বেতন কিস্তিতে দেওয়ার অনুরোধ',
      body: 'আর্থিক অসুবিধার কারণে বেতন দুই কিস্তিতে দেওয়ার অনুমতি চাই।',
    }),
    addressee: ApplicationAddressee.HEADMASTER,
  });

  // PAPER entries by office staff (D46): one for a guardian with a login, one without.
  await file(officeCaller, {
    ...forStudent(ApplicationType.STUDENT_LEAVE, {
      reason_kind: 'FAMILY',
      start_date: '2026-03-18',
      end_date: '2026-03-18',
      details: 'পারিবারিক অনুষ্ঠান',
    }),
    on_behalf_of_user_id: guardian.user_id,
  });
  await file(officeCaller, {
    ...forStudent(ApplicationType.GENERAL, {
      subject_line: 'ক্লাসের সময় পরিবর্তনের অনুরোধ',
      body: 'সন্তানের ক্লাসের সময় পরিবর্তনের অনুরোধ জানাচ্ছি।',
    }),
    applicant_name: 'আব্দুল করিম',
    addressee: ApplicationAddressee.HEADMASTER,
  });

  // A guardian cannot tag at submit (D50), so staff tag after the fact.
  await ports.addTags(tenantId, admin, general.id, [{ user_id: adminUserId }]);
  await ports.addTags(tenantId, admin, idCard.id, [{ role: UserRole.OFFICE_STAFF }]);
  await ports.comment(tenantId, admin, studentLeave.id, 'অভিভাবকের সাথে যোগাযোগ করা হয়েছে।');
  await ensureDecidedApplicationsSeed(repos, tenantId, adminUserId);
}

type SeedStudent = { id: string; class_section_id: string };

/**
 * [52.3.6] Decided and mid-chain applications, written as rows (like `seed.lifecycle.ts`), never
 * by replaying the decision service. Idempotent: skips when any non-PENDING application exists
 * (52.2.7 seeds PENDING rows only). Dates are fixed in March of the demo year and clear of the
 * pending leaves (4-5, 18 and 24-25 March) and the approved demo leave of 10-11 March.
 */
export async function ensureDecidedApplicationsSeed(
  repos: ApplicationsSeedRepositories,
  tenantId: string,
  adminUserId: string,
): Promise<void> {
  const nonPending = await repos.applicationRepository.count({
    where: { tenant_id: tenantId, status: Not(ApplicationStatus.PENDING) },
  });
  if (nonPending > 0) return;
  const m = repos.applicationRepository.manager;

  const teacherUser = await repos.userRepository.findOne({ where: { email: TEACHER_EMAIL } });
  const staff = teacherUser
    ? await repos.staffProfileRepository.findOne({
        where: { tenant_id: tenantId, user_id: teacherUser.id },
      })
    : null;
  const students: SeedStudent[] = [];
  for (let n = 1; n <= 5; n += 1) {
    const [row] = await m.query(
      `SELECT id, class_section_id FROM students WHERE tenant_id = $1 AND registration_number = $2`,
      [tenantId, `${DEMO_ACADEMIC_YEAR.name}-${String(n).padStart(4, '0')}`],
    );
    if (row) students.push(row);
  }
  if (!staff || students.length < 5) {
    console.warn('Demo teacher/students not found — skipping decided applications seed.');
    return;
  }
  const [s1, s2, s3, s4, s5] = students;
  const [otherSection] = await m.query(
    `SELECT id FROM class_sections WHERE tenant_id = $1 AND id <> $2 LIMIT 1`,
    [tenantId, s3.class_section_id],
  );
  if (!otherSection) {
    console.warn('No second section — skipping decided applications seed.');
    return;
  }
  const [year] = await m.query(`SELECT id FROM academic_years WHERE tenant_id = $1 AND name = $2`, [
    tenantId,
    DEMO_ACADEMIC_YEAR.name,
  ]);

  const classTeacherOf = async (sectionId: string): Promise<string> => {
    const [row] = await m.query(
      `SELECT t.user_id FROM teacher_class_sections tcs
         JOIN teachers t ON t.id = tcs.teacher_id AND t.tenant_id = tcs.tenant_id
        WHERE tcs.tenant_id = $1 AND tcs.section_id = $2 AND tcs.assignment_type = 'CLASS_TEACHER'
        ORDER BY t.user_id LIMIT 1`,
      [tenantId, sectionId],
    );
    return row?.user_id ?? adminUserId;
  };
  const guardianUserOf = async (studentId: string): Promise<string> => {
    const [row] = await m.query(
      `SELECT g.user_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.student_id = $1 AND g.tenant_id = $2 AND g.user_id IS NOT NULL LIMIT 1`,
      [studentId, tenantId],
    );
    // No guardian with a login: the admin stands in as the (fake) applicant.
    return row?.user_id ?? adminUserId;
  };

  await m.transaction(async (tx) => {
    // Serials continue after the highest one (the seed runs alone, so plain max + 1).
    const [{ y, n }] = await tx.query(
      `SELECT y, coalesce((SELECT max(serial_no) FROM applications
                            WHERE tenant_id = $1 AND serial_year = y), 0) AS n
         FROM (SELECT coalesce(max(serial_year), 2026) AS y FROM applications WHERE tenant_id = $1) t`,
      [tenantId],
    );
    let serialNo = Number(n);
    const base = Date.parse('2026-03-01T04:00:00Z');
    let tick = 0;
    const at = () => new Date(base + (tick += 1) * 60_000);

    const K = ApplicationEventKind;
    const S = ApplicationStatus;
    type Event = {
      kind: ApplicationEventKind;
      actor: string;
      step: number | null;
      note?: string;
      data?: Record<string, unknown>;
    };
    type Row = {
      type: ApplicationType;
      status: ApplicationStatus;
      applicant: string;
      studentId?: string;
      staffId?: string;
      payload: Record<string, unknown>;
      start?: string;
      end?: string;
      step: number;
      decidedBy?: string;
      effect?: Record<string, unknown>;
      events: Event[];
    };
    const insert = async (r: Row): Promise<string> => {
      serialNo += 1;
      const [{ id }] = await tx.query(
        `INSERT INTO applications (tenant_id, type, status, source, serial_year, serial_no,
           academic_year_id, applicant_user_id, subject_student_id, subject_staff_profile_id,
           payload, start_date, end_date, current_step, letter_text, letter_locale,
           effect_result, decided_by_user_id, decided_at)
         VALUES ($1,$2,$3,'APP',$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,'bn',$15::jsonb,$16,$17)
         RETURNING id`,
        [
          tenantId,
          r.type,
          r.status,
          Number(y),
          serialNo,
          year?.id ?? null,
          r.applicant,
          r.studentId ?? null,
          r.staffId ?? null,
          JSON.stringify(r.payload),
          r.start ?? null,
          r.end ?? null,
          r.step,
          `Demo ${r.type} application.`,
          r.effect ? JSON.stringify(r.effect) : null,
          r.decidedBy ?? null,
          r.decidedBy ? at() : null,
        ],
      );
      for (const e of r.events) {
        await tx.query(
          `INSERT INTO application_events
             (tenant_id, application_id, actor_user_id, kind, step, note, data, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
          [
            tenantId,
            id,
            e.actor,
            e.kind,
            e.step,
            e.note ?? null,
            e.data ? JSON.stringify(e.data) : null,
            at(),
          ],
        );
      }
      return id;
    };

    // 1. APPROVED STAFF_LEAVE: 3 working days, ledger row + LEAVE marks on the staff register.
    const leave = { leave_type: 'CASUAL', start_date: '2026-03-16', end_date: '2026-03-18' };
    const leaveDates = ['2026-03-16', '2026-03-17', '2026-03-18'];
    const staffAppId = await insert({
      type: ApplicationType.STAFF_LEAVE,
      status: S.APPROVED,
      applicant: staff.user_id,
      staffId: staff.id,
      payload: { ...leave, reason: 'পারিবারিক কাজ' },
      start: leave.start_date,
      end: leave.end_date,
      step: 0,
      decidedBy: adminUserId,
      events: [
        { kind: K.SUBMITTED, actor: staff.user_id, step: null },
        { kind: K.APPROVED, actor: adminUserId, step: 0 },
      ],
    });
    const [{ id: leaveRecordId }] = await tx.query(
      `INSERT INTO leave_records (tenant_id, staff_profile_id, leave_type, start_date, end_date, days,
         status, reason, approved_by, decided_at, application_id)
       VALUES ($1,$2,'CASUAL',$3,$4,3,'APPROVED','পারিবারিক কাজ',$5,now(),$6) RETURNING id`,
      [tenantId, staff.id, leave.start_date, leave.end_date, adminUserId, staffAppId],
    );
    for (const date of leaveDates) {
      await tx.query(
        `INSERT INTO staff_attendance_sessions (tenant_id, date) VALUES ($1,$2)
         ON CONFLICT (tenant_id, date) DO NOTHING`,
        [tenantId, date],
      );
      await tx.query(
        `INSERT INTO staff_attendance_records (tenant_id, session_id, staff_profile_id, status, source)
         SELECT $1, s.id, $3, 'LEAVE', 'SYSTEM' FROM staff_attendance_sessions s
          WHERE s.tenant_id = $1 AND s.date = $2
         ON CONFLICT (session_id, staff_profile_id) DO UPDATE SET status = 'LEAVE', source = 'SYSTEM'`,
        [tenantId, date, staff.id],
      );
    }
    await tx.query(`UPDATE applications SET effect_result = $2::jsonb WHERE id = $1`, [
      staffAppId,
      JSON.stringify({
        leave_record_id: leaveRecordId,
        days: 3,
        attendance_dates: leaveDates,
        follow_up: { kind: 'SUBSTITUTE', from: leave.start_date, to: leave.end_date },
      }),
    ]);

    // 2. APPROVED STUDENT_LEAVE (student 0004): LEAVE marks in the whole-day session (D21).
    const ct4 = await classTeacherOf(s4.class_section_id);
    const parent4 = await guardianUserOf(s4.id);
    const stuDates = ['2026-03-22', '2026-03-23'];
    await insert({
      type: ApplicationType.STUDENT_LEAVE,
      status: S.APPROVED,
      applicant: parent4,
      studentId: s4.id,
      payload: {
        reason_kind: 'SICK',
        start_date: stuDates[0],
        end_date: stuDates[1],
        details: 'জ্বর',
      },
      start: stuDates[0],
      end: stuDates[1],
      step: 0,
      decidedBy: ct4,
      effect: { days: 2, attendance_dates: stuDates },
      events: [
        { kind: K.SUBMITTED, actor: parent4, step: null },
        { kind: K.APPROVED, actor: ct4, step: 0 },
      ],
    });
    for (const date of stuDates) await markStudentLeave(tx, tenantId, s4, date, ct4);

    // 3. REJECTED TESTIMONIAL (student 0002), with a reason.
    const parent2 = await guardianUserOf(s2.id);
    await insert({
      type: ApplicationType.TESTIMONIAL,
      status: S.REJECTED,
      applicant: parent2,
      studentId: s2.id,
      payload: { purpose: 'বৃত্তির আবেদন' },
      step: 0,
      decidedBy: adminUserId,
      events: [
        { kind: K.SUBMITTED, actor: parent2, step: null },
        {
          kind: K.REJECTED,
          actor: adminUserId,
          step: 0,
          note: 'প্রয়োজনীয় কাগজপত্র জমা দেওয়া হয়নি।',
        },
      ],
    });

    // 4. CANCELLED STUDENT_LEAVE (student 0005): approved, then cancelled; no marks left.
    const ct5 = await classTeacherOf(s5.class_section_id);
    const parent5 = await guardianUserOf(s5.id);
    await insert({
      type: ApplicationType.STUDENT_LEAVE,
      status: S.CANCELLED,
      applicant: parent5,
      studentId: s5.id,
      payload: {
        reason_kind: 'FAMILY',
        start_date: '2026-03-29',
        end_date: '2026-03-30',
        details: 'পারিবারিক অনুষ্ঠান',
      },
      start: '2026-03-29',
      end: '2026-03-30',
      step: 0,
      decidedBy: ct5,
      effect: { days: 2, attendance_dates: ['2026-03-29', '2026-03-30'] },
      events: [
        { kind: K.SUBMITTED, actor: parent5, step: null },
        { kind: K.APPROVED, actor: ct5, step: 0 },
        { kind: K.CANCELLED, actor: adminUserId, step: 0, note: 'অভিভাবক ছুটি বাতিল করতে বলেছেন।' },
      ],
    });

    // 5. FEE_WAIVER at step 1: the class teacher approved; the step-up approval is still to come.
    const ct1 = await classTeacherOf(s1.class_section_id);
    const parent1 = await guardianUserOf(s1.id);
    await insert({
      type: ApplicationType.FEE_WAIVER,
      status: S.PENDING,
      applicant: parent1,
      studentId: s1.id,
      payload: { kind: 'FLAT', value: 500, reason: 'আর্থিক অসুবিধা' },
      step: 1,
      events: [
        { kind: K.SUBMITTED, actor: parent1, step: null },
        { kind: K.STEP_APPROVED, actor: ct1, step: 0, data: { auto_skipped: [] } },
      ],
    });

    // 6. UNDER_CONSIDERATION SECTION_CHANGE (student 0003).
    const parent3 = await guardianUserOf(s3.id);
    await insert({
      type: ApplicationType.SECTION_CHANGE,
      status: S.UNDER_CONSIDERATION,
      applicant: parent3,
      studentId: s3.id,
      payload: { to_section_id: otherSection.id, reason: 'বাড়ির কাছে' },
      step: 0,
      events: [
        { kind: K.SUBMITTED, actor: parent3, step: null },
        { kind: K.UNDER_CONSIDERATION, actor: adminUserId, step: 0, note: 'বিবেচনাধীন' },
      ],
    });
  });
  console.log('Decided applications seeded (6 rows).');
}

/** Whole-day (`period_no` NULL) LEAVE mark by SYSTEM; a day already marked ABSENT is converted (D21). */
async function markStudentLeave(
  tx: EntityManager,
  tenantId: string,
  student: SeedStudent,
  date: string,
  actorUserId: string,
): Promise<void> {
  let [session] = await tx.query(
    `SELECT id FROM attendance_sessions
      WHERE tenant_id = $1 AND section_id = $2 AND date = $3 AND period_no IS NULL`,
    [tenantId, student.class_section_id, date],
  );
  if (!session) {
    [session] = await tx.query(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, period_no, subject_id, source, state)
       VALUES ($1,$2,$3,NULL,NULL,'SYSTEM','DRAFT') RETURNING id`,
      [tenantId, student.class_section_id, date],
    );
  }
  await tx.query(
    `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status, source, recorded_by_user_id)
     VALUES ($1,$2,$3,$4,'LEAVE','SYSTEM',$5)
     ON CONFLICT (session_id, student_id) DO UPDATE
       SET status = 'LEAVE', source = 'SYSTEM', recorded_by_user_id = $5
       WHERE attendance_records.status = 'ABSENT'`,
    [tenantId, session.id, student.id, date, actorUserId],
  );
}
