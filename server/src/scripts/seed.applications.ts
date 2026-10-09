import type { Repository } from 'typeorm';
import {
  ApplicationAddressee,
  ApplicationEventKind,
  ApplicationSource,
  ApplicationStatus,
  ApplicationType,
} from '@biddaloy/shared';
import type { AcademicYear } from '../modules/academics/entities/academic-year.entity';
import type { Application } from '../modules/applications/entities/application.entity';
import type { ApplicationEvent } from '../modules/applications/entities/application-event.entity';
import type { StaffProfile } from '../modules/staff-profiles/entities/staff-profile.entity';
import type { Guardian } from '../modules/students/entities/guardian.entity';
import { DEMO_ACADEMIC_YEAR } from './seed.util';

// Kept out of seed.ts on purpose (same reason as seed.lifecycle.ts): this file
// must not import anything that reaches AppModule.

export interface ApplicationsSeedRepositories {
  applicationRepository: Repository<Application>;
  eventRepository: Repository<ApplicationEvent>;
  staffProfileRepository: Repository<StaffProfile>;
  guardianRepository: Repository<Guardian>;
  academicYearRepository: Repository<AcademicYear>;
}

const PARENT_EMAIL = 'parent@biddaloy.test';
const SERIAL_YEAR = 2026;

/**
 * [52.1.6] Three PENDING demo applications (D42), one SUBMITTED event each.
 * Rows are written directly, not through the applications service (that lands
 * in 52.2.7). Idempotent: each row is looked up by `(tenant, year, serial)`.
 *
 *  2026/1 STAFF_LEAVE   the first staff profile (by employee_id), 2 days CASUAL
 *  2026/2 STUDENT_LEAVE the parent's child, applied by the parent login
 *  2026/3 GENERAL       PAPER, entered by the admin for a guardian with no login (D46)
 */
export async function ensureApplicationsSeed(
  repos: ApplicationsSeedRepositories,
  tenantId: string,
  adminUserId: string,
): Promise<void> {
  const [staff] = await repos.staffProfileRepository.find({
    where: { tenant_id: tenantId },
    order: { employee_id: 'ASC' },
    take: 1,
  });
  const guardian = await repos.guardianRepository.findOne({
    where: { tenant_id: tenantId, user: { email: PARENT_EMAIL } },
    relations: { students: true },
  });
  const student = guardian?.students?.[0];
  const year = await repos.academicYearRepository.findOne({
    where: { tenant_id: tenantId, name: DEMO_ACADEMIC_YEAR.name },
  });
  if (!staff || !guardian?.user_id || !student || !year) {
    console.warn('Demo staff/parent/student/year not found — skipping applications seed.');
    return;
  }

  const base = {
    tenant_id: tenantId,
    serial_year: SERIAL_YEAR,
    status: ApplicationStatus.PENDING,
    academic_year_id: year.id,
    letter_locale: 'bn',
  };
  const rows: { serial_no: number; actor: string; data: Partial<Application> }[] = [
    {
      serial_no: 1,
      actor: staff.user_id,
      data: {
        type: ApplicationType.STAFF_LEAVE,
        source: ApplicationSource.APP,
        subject_staff_profile_id: staff.id,
        applicant_user_id: staff.user_id,
        start_date: '2026-03-24',
        end_date: '2026-03-25',
        payload: {
          leave_type: 'CASUAL',
          start_date: '2026-03-24',
          end_date: '2026-03-25',
          reason: 'পারিবারিক কাজ',
        },
        letter_text: 'আমি ২৪ ও ২৫ মার্চ নৈমিত্তিক ছুটির জন্য আবেদন করছি।',
      },
    },
    {
      serial_no: 2,
      actor: guardian.user_id,
      data: {
        type: ApplicationType.STUDENT_LEAVE,
        source: ApplicationSource.APP,
        subject_student_id: student.id,
        applicant_user_id: guardian.user_id,
        start_date: '2026-03-04',
        end_date: '2026-03-05',
        payload: {
          reason_kind: 'SICK',
          start_date: '2026-03-04',
          end_date: '2026-03-05',
          details: 'জ্বর',
        },
        letter_text: 'আমার সন্তান জ্বরের কারণে ৪ ও ৫ মার্চ স্কুলে আসতে পারবে না।',
      },
    },
    {
      serial_no: 3,
      actor: adminUserId,
      data: {
        type: ApplicationType.GENERAL,
        source: ApplicationSource.PAPER,
        entered_by_user_id: adminUserId,
        applicant_user_id: null,
        applicant_name: 'আব্দুল করিম',
        subject_student_id: student.id,
        addressee: ApplicationAddressee.HEADMASTER,
        payload: {
          subject_line: 'বেতন কিস্তিতে দেওয়ার অনুরোধ',
          body: 'আর্থিক অসুবিধার কারণে বেতন দুই কিস্তিতে দেওয়ার অনুমতি চাই।',
        },
        letter_text: 'আমি বেতন দুই কিস্তিতে পরিশোধের অনুমতি চাই।',
      },
    },
  ];

  for (const { serial_no, actor, data } of rows) {
    const existing = await repos.applicationRepository.findOne({
      where: { tenant_id: tenantId, serial_year: SERIAL_YEAR, serial_no },
    });
    if (existing) continue;
    const app = await repos.applicationRepository.save(
      repos.applicationRepository.create({ ...base, serial_no, ...data }),
    );
    await repos.eventRepository.save(
      repos.eventRepository.create({
        tenant_id: tenantId,
        application_id: app.id,
        actor_user_id: actor,
        kind: ApplicationEventKind.SUBMITTED,
        step: 0,
      }),
    );
  }
}
