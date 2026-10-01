import type { Repository } from 'typeorm';
import { PublicExamType, StudentLifecycleEventType } from '@biddaloy/shared';
import type { AcademicYear } from '../modules/academics/entities/academic-year.entity';
import type { Enrollment } from '../modules/students/entities/enrollment.entity';
import type { Student } from '../modules/students/entities/student.entity';
import type { StudentLifecycleEvent } from '../modules/students/entities/student-lifecycle-event.entity';
import type { StudentNote } from '../modules/students/entities/student-note.entity';
import type { StudentPublicExam } from '../modules/students/entities/student-public-exam.entity';
import { DEMO_ACADEMIC_YEAR } from './seed.util';

// Kept out of seed.ts on purpose: seed.ts imports AppModule, whose
// ConfigModule validates env at import time, so a unit spec importing it
// throws when no .env exists. This file must not import anything that
// reaches AppModule.

export interface StudentLifecycleSeedRepositories {
  studentRepository: Repository<Student>;
  enrollmentRepository: Repository<Enrollment>;
  academicYearRepository: Repository<AcademicYear>;
  lifecycleEventRepository: Repository<StudentLifecycleEvent>;
  noteRepository: Repository<StudentNote>;
  publicExamRepository: Repository<StudentPublicExam>;
}

/**
 * [39.1.4] Fixed demo rows for the Epic 39 tables, on the demo roster's
 * students 0001..0006 (`ensureDemoStudents`). Idempotent: every row is
 * looked up by its natural key first. Rows only — like a workbook restore,
 * this never replays `StudentLifecycleService`, so enrollment/student
 * statuses are left as the roster seeded them.
 *
 *  0001 WITHDRAWN then READMITTED (same year, so D16 reactivates one enrollment)
 *  0002 TRANSFERRED_OUT   0003 GRADUATED   0004/0005 one note each
 *  0003 SSC + JSC results                         0001-0003 parent/religion/birth-reg/health
 */
export async function ensureStudentLifecycleSeed(
  repos: StudentLifecycleSeedRepositories,
  tenantId: string,
  authorUserId: string,
): Promise<void> {
  const regNo = (n: number) => `${DEMO_ACADEMIC_YEAR.name}-${String(n).padStart(4, '0')}`;
  const students = await Promise.all(
    [1, 2, 3, 4, 5].map((n) =>
      repos.studentRepository.findOne({
        where: { tenant_id: tenantId, registration_number: regNo(n) },
      }),
    ),
  );
  const year1 = await repos.academicYearRepository.findOne({
    where: { tenant_id: tenantId, name: DEMO_ACADEMIC_YEAR.name },
  });
  if (students.some((s) => !s) || !year1) {
    console.warn('Demo students/year not found — skipping student lifecycle seed.');
    return;
  }
  const [s1, s2, s3, s4, s5] = students as Student[];

  // --- student columns (only fill blanks, never overwrite hand edits) -----
  const profiles = [
    [s1, 'Abdul Karim', 'Rahima Begum', 'Islam', '20122604150000001', 'Mild asthma'],
    [s2, 'Mizanur Rahman', 'Salma Khatun', 'Hinduism', '20122604150000002', null],
    [s3, 'Shafiqul Islam', 'Nasima Akter', 'Islam', '20122604150000003', 'Peanut allergy'],
  ] as const;
  for (const [s, father, mother, religion, birthReg, health] of profiles) {
    if (s.father_name || s.mother_name || s.religion || s.birth_reg_no || s.health_notes) continue;
    Object.assign(s, {
      father_name: father,
      mother_name: mother,
      religion,
      birth_reg_no: birthReg,
      health_notes: health,
    });
    await repos.studentRepository.save(s);
  }

  // --- lifecycle events ----------------------------------------------------
  const events = [
    [s1, year1, StudentLifecycleEventType.WITHDRAWN, '2026-05-10', 'Family relocated', null],
    [s1, year1, StudentLifecycleEventType.READMITTED, '2026-08-10', 'Family returned', null],
    [
      s2,
      year1,
      StudentLifecycleEventType.TRANSFERRED_OUT,
      '2026-06-15',
      'Father transferred',
      'Dhaka Residential Model College',
    ],
    [s3, year1, StudentLifecycleEventType.GRADUATED, '2026-12-20', 'Completed final year', null],
  ] as const;
  for (const [s, year, type, occurredOn, reason, destination] of events) {
    const where = {
      tenant_id: tenantId,
      student_id: s.id,
      event_type: type,
      occurred_on: occurredOn,
    };
    if (await repos.lifecycleEventRepository.findOne({ where })) continue;
    // The event's year and its enrollment's year must agree (the report filters on the
    // event's year), so look the enrollment up by that year.
    const enrollment = await repos.enrollmentRepository.findOne({
      where: { tenant_id: tenantId, student_id: s.id, academic_year_id: year.id },
    });
    if (!enrollment) continue;
    await repos.lifecycleEventRepository.save(
      repos.lifecycleEventRepository.create({
        ...where,
        enrollment_id: enrollment.id,
        academic_year_id: year.id,
        reason,
        destination,
        remark: null,
        recorded_by_user_id: authorUserId,
      }),
    );
  }

  // --- notes ---------------------------------------------------------------
  for (const [s, body] of [
    [s4, 'Parents asked for a meeting about reading support.'],
    [s5, 'Excellent class monitor; recommended for the debate club.'],
  ] as const) {
    const where = { tenant_id: tenantId, student_id: s.id, body };
    if (await repos.noteRepository.findOne({ where })) continue;
    await repos.noteRepository.save(
      repos.noteRepository.create({ ...where, author_user_id: authorUserId }),
    );
  }

  // --- public exams --------------------------------------------------------
  for (const [type, roll, gpa, passingYear] of [
    [PublicExamType.JSC, '410021', '4.50', 2024],
    [PublicExamType.SSC, '520033', '4.83', 2026],
  ] as const) {
    const where = { tenant_id: tenantId, student_id: s3.id, exam_type: type };
    if (await repos.publicExamRepository.findOne({ where })) continue;
    await repos.publicExamRepository.save(
      repos.publicExamRepository.create({
        ...where,
        board: 'Dhaka',
        roll_no: roll,
        registration_no: `REG-${roll}`,
        gpa,
        passing_year: passingYear,
      }),
    );
  }
}
