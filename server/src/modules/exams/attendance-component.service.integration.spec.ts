import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { AttendanceModule } from '../attendance/attendance.module';
import { AuthModule } from '../auth/auth.module';
import { sectionRosterStudentIds } from '../enrollments/section-roster';
import { AttendanceComponentService } from './attendance-component.service';
import { AttendanceSession } from '../attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../attendance/entities/attendance-record.entity';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../calendar/entities/calendar-event-class.entity';
import { Exam } from './entities/exam.entity';
import {
  AttendanceSessionState,
  AttendanceStatus,
  EnrollmentStatus,
  ExamKind,
} from '@biddaloy/shared';

/**
 * X-01: an exam's attendance component must be computed for the students
 * ENROLLED in the exam's section, using the exam's class — not where the
 * students sit today (`Student.class_section_id`), which moves on promotion.
 */
describe('AttendanceComponentService (integration)', () => {
  let service: AttendanceComponentService;
  let ds: DataSource;
  const TENANT_ID = SEED_TENANT_ID;
  const stamp = Date.now();

  let c1: Class;
  let s1: ClassSection;
  let c2: Class;
  let s2: ClassSection;
  let exam: Exam;
  let studentA: Student;
  let studentB: Student;
  let y1Id: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [AttendanceComponentService],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, AuthModule],
    );
    service = module.get(AttendanceComponentService);
    ds = module.get<DataSource>(getDataSourceToken());

    const y1 = await ds.getRepository(AcademicYear).save({
      name: `AC Y1 ${stamp}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });
    const y2 = await ds.getRepository(AcademicYear).save({
      name: `AC Y2 ${stamp}`,
      start_date: '2027-01-01',
      end_date: '2027-12-31',
      tenant_id: TENANT_ID,
    });
    c1 = await ds
      .getRepository(Class)
      .save({ name: `AC C1 ${stamp}`, academic_year_id: y1.id, tenant_id: TENANT_ID });
    c2 = await ds
      .getRepository(Class)
      .save({ name: `AC C2 ${stamp}`, academic_year_id: y2.id, tenant_id: TENANT_ID });
    s1 = await ds
      .getRepository(ClassSection)
      .save({ section_name: 'AC S1', class_id: c1.id, tenant_id: TENANT_ID });
    s2 = await ds
      .getRepository(ClassSection)
      .save({ section_name: 'AC S2', class_id: c2.id, tenant_id: TENANT_ID });
    y1Id = y1.id;
  }, 60000);

  // Transactional tables are cleared before every test (test/setup.ts), so
  // everything below the year/class/section reference rows is re-seeded here.
  beforeEach(async () => {
    await ds
      .getRepository(School)
      .update(
        { id: TENANT_ID },
        { settings: { version: 1, attendance: { weeklyOffDays: [] } } as any },
      );
    const y1 = { id: y1Id };
    const term = await ds.getRepository(AcademicTerm).save({
      tenant_id: TENANT_ID,
      academic_year_id: y1.id,
      seq: 1,
      name: 'AC Term',
      start_date: '2026-03-02',
      end_date: '2026-03-06',
    });
    exam = await ds.getRepository(Exam).save({
      tenant_id: TENANT_ID,
      academic_year_id: y1.id,
      class_id: c1.id,
      academic_term_id: term.id,
      name: `AC Exam ${stamp}`,
      kind: ExamKind.TERM,
    });

    const mk = (roll: number) =>
      ds.getRepository(Student).save({
        full_name: `AC Student ${roll}`,
        registration_number: `AC-REG-${roll}-${stamp}`,
        roll_number: roll,
        class_section_id: s1.id,
        tenant_id: TENANT_ID,
      });
    studentA = await mk(1);
    studentB = await mk(2);
    for (const [st, status] of [
      [studentA, EnrollmentStatus.ACTIVE],
      [studentB, EnrollmentStatus.ACTIVE],
    ] as const) {
      await ds.getRepository(Enrollment).save({
        tenant_id: TENANT_ID,
        student_id: st.id,
        academic_year_id: y1.id,
        class_id: c1.id,
        section_id: s1.id,
        enrollment_status: status,
      });
    }

    // 5 working days (Mon-Fri, weekly off disabled). A: all present. B: 3 of 5.
    const session = async (date: string) =>
      ds.getRepository(AttendanceSession).save({
        tenant_id: TENANT_ID,
        section_id: s1.id,
        date,
        period_no: null,
        state: AttendanceSessionState.FINALIZED,
      });
    const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'];
    for (const [i, date] of days.entries()) {
      const sess = await session(date);
      for (const [st, present] of [
        [studentA, true],
        [studentB, i < 3],
      ] as const) {
        await ds.getRepository(AttendanceRecord).save({
          tenant_id: TENANT_ID,
          session_id: sess.id,
          student_id: st.id,
          date,
          status: present ? AttendanceStatus.PRESENT : AttendanceStatus.ABSENT,
        });
      }
    }
  });

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const compute = () =>
    service.computeForSection({
      examId: exam.id,
      sectionId: s1.id,
      fullMarks: '10',
      tenantId: TENANT_ID,
    });

  it('X-01: gives the same values before and after promotion moves the students', async () => {
    const before = await compute();
    expect(before.valuesByStudent.get(studentA.id)).toBe('10.00');
    expect(before.valuesByStudent.get(studentB.id)).toBe('6.00');

    // Promote: new-year ACTIVE enrollment + students.class_section_id moves
    // (what EnrollmentService.syncStudentPlacement does). The Y1 enrollment
    // row keeps its section_id.
    for (const st of [studentA, studentB]) {
      await ds.getRepository(Enrollment).save({
        tenant_id: TENANT_ID,
        student_id: st.id,
        academic_year_id: c2.academic_year_id,
        class_id: c2.id,
        section_id: s2.id,
        enrollment_status: EnrollmentStatus.ACTIVE,
      });
      await ds.getRepository(Student).update({ id: st.id }, { class_section_id: s2.id });
    }

    const after = await compute();
    expect(after.valuesByStudent.get(studentA.id)).toBe('10.00');
    expect(after.valuesByStudent.get(studentB.id)).toBe('6.00');
  });

  it('working days come from the exam class: a C1 holiday still counts after students moved to C2', async () => {
    const event = await ds.getRepository(CalendarEvent).save({
      tenant_id: TENANT_ID,
      academic_year_id: exam.academic_year_id,
      start_date: '2026-03-06',
      end_date: '2026-03-06',
      name: 'C1 only holiday',
      counts_as_working_day: false,
      published_at: new Date(),
    });
    await ds
      .getRepository(CalendarEventClass)
      .save({ event_id: event.id, class_id: c1.id, tenant_id: TENANT_ID });
    try {
      // 4 working days now; A 4/4 = 100%, B 3/4 = 75% -> 7.50.
      const r = await compute();
      expect(r.valuesByStudent.get(studentA.id)).toBe('10.00');
      expect(r.valuesByStudent.get(studentB.id)).toBe('7.50');
    } finally {
      await ds.getRepository(CalendarEvent).delete({ id: event.id });
    }
  });

  // Review r1 #1: the results cohort (loadExamCohort) keeps a non-ACTIVE
  // enrollment that has marks, so the attendance part must keep it too, or a
  // recompute after they leave/graduate turns their attendance into EXEMPT.
  it('a student who left (INACTIVE enrollment) after the exam keeps their attendance value', async () => {
    await ds
      .getRepository(Enrollment)
      .update(
        { student_id: studentB.id, section_id: s1.id },
        { enrollment_status: EnrollmentStatus.INACTIVE },
      );
    const r = await compute();
    expect(r.valuesByStudent.get(studentB.id)).toBe('6.00');
    expect(r.valuesByStudent.get(studentA.id)).toBe('10.00');
  });

  it('a student who graduated after the exam keeps their attendance value', async () => {
    await ds
      .getRepository(Enrollment)
      .update(
        { student_id: studentB.id, section_id: s1.id },
        { enrollment_status: EnrollmentStatus.GRADUATED },
      );
    const r = await compute();
    expect(r.valuesByStudent.get(studentB.id)).toBe('6.00');
  });

  it('roster is tenant-scoped and skips soft-deleted students', async () => {
    // Same section_id but another tenant: must not leak into tenant A.
    const other = await ds.getRepository(School).save({
      name: `AC Other ${stamp}`,
      slug: `ac-other-${stamp}`,
    } as any);
    const foreign = await ds.getRepository(Student).save({
      full_name: 'AC Foreign',
      registration_number: `AC-FOREIGN-${stamp}`,
      roll_number: 9,
      class_section_id: s1.id,
      tenant_id: (other as School).id,
    });
    await ds.getRepository(Enrollment).save({
      tenant_id: (other as School).id,
      student_id: foreign.id,
      academic_year_id: y1Id,
      class_id: c1.id,
      section_id: s1.id,
      enrollment_status: EnrollmentStatus.ACTIVE,
    });
    await ds.getRepository(Student).softDelete({ id: studentB.id });

    const ids = await sectionRosterStudentIds(ds.manager, TENANT_ID, s1.id);
    expect(ids).toEqual([studentA.id]);
  });
});
