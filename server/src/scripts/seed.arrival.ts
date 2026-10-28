import type { Repository } from 'typeorm';
import {
  ArrivalNoticeChannel,
  ArrivalNoticeLock,
  ArrivalNoticeMode,
  ArrivalNoticeStatus,
} from '@biddaloy/shared';
import type { ArrivalNoticeSubscription } from '../modules/attendance/entities/arrival-notice-subscription.entity';
import type { School } from '../modules/schools/entities/school.entity';
import type { Guardian } from '../modules/students/entities/guardian.entity';
import type { Student } from '../modules/students/entities/student.entity';
import { DEMO_ACADEMIC_YEAR } from './seed.util';

// Like seed.attention.ts: must not import anything that reaches AppModule.

export interface ArrivalSeedRepositories {
  studentRepository: Repository<Student>;
  guardianRepository: Repository<Guardian>;
  arrivalSubscriptionRepository: Repository<ArrivalNoticeSubscription>;
}

/**
 * [84.4.4] Arrival notices on for the e2e school (the default is off), app only. The switch is
 * part of the seed so no e2e spec has to turn it on and off: specs run in parallel, and one
 * spec switching it off would silence another spec's register. Only flips the default (absent),
 * like `ensureAttendancePeriodSetting`; returns whether it changed anything.
 */
export function ensureArrivalNoticeSetting(school: School): boolean {
  const attendance = school.settings?.attendance;
  if (attendance?.arrivalNotice !== undefined) return false;
  school.settings = {
    ...(school.settings ?? {}),
    attendance: { ...attendance, arrivalNotice: { enabled: true, smsAllowed: false } },
  } as School['settings'];
  return true;
}

/** [84.4.4 / D33] The guardian behind `parent@biddaloy.test` (see `ensureDemoStudents`). */
const PARENT_GUARDIAN_EMAIL = 'guardian1@biddaloy.test';

/**
 * One ACTIVE RECURRING PUSH arrival-notice subscription for `parent@biddaloy.test`'s roll-1 child
 * in the class teacher's section, so Playwright has a row to read. Find-or-create: a hand-changed
 * row is left alone.
 */
export async function ensureArrivalSeed(
  repos: ArrivalSeedRepositories,
  tenantId: string,
): Promise<void> {
  const student = await repos.studentRepository.findOne({
    where: { tenant_id: tenantId, registration_number: `${DEMO_ACADEMIC_YEAR.name}-0001` },
  });
  const guardian = await repos.guardianRepository.findOne({
    where: { tenant_id: tenantId, email: PARENT_GUARDIAN_EMAIL },
  });
  if (!student || !guardian) {
    console.warn('Demo student/guardian not found — skipping arrival-notice seed.');
    return;
  }
  const key = { tenant_id: tenantId, student_id: student.id, guardian_id: guardian.id };
  if (await repos.arrivalSubscriptionRepository.findOne({ where: key })) return;
  await repos.arrivalSubscriptionRepository.save(
    repos.arrivalSubscriptionRepository.create({
      ...key,
      status: ArrivalNoticeStatus.ACTIVE,
      mode: ArrivalNoticeMode.RECURRING,
      channel: ArrivalNoticeChannel.PUSH,
      lock: ArrivalNoticeLock.NONE,
    }),
  );
}
