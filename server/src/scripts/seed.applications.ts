import type { Repository } from 'typeorm';
import { ApplicationAddressee, ApplicationType, UserRole } from '@biddaloy/shared';
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
}
