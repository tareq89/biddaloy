import type { EntityManager } from 'typeorm';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Exam } from '../exams/entities/exam.entity';
import { ExamTemplate } from '../exams/entities/exam-template.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { Homework } from '../homework/entities/homework.entity';
import { SyllabusTopic } from '../homework/entities/syllabus-topic.entity';
import { RoutineSlot } from '../routines/entities/routine-slot.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { PromotionRun } from '../promotions/entities/promotion-run.entity';
import { AttendanceSession } from '../attendance/entities/attendance-session.entity';

export interface BlockerEntity {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entity: new () => any;
}

/** D33: a school is "fresh" only while none of these exist. */
export const FRESH_TENANT_ENTITIES: BlockerEntity[] = [
  { label: 'academic years', entity: AcademicYear },
  { label: 'classes', entity: Class },
  { label: 'subjects', entity: Subject },
  { label: 'students', entity: Student },
  { label: 'exams', entity: Exam },
  { label: 'grading scales', entity: GradingScale },
  { label: 'exam templates', entity: ExamTemplate },
];

/** D34: reset is blocked while any of these exist. */
export const RESET_BLOCKER_ENTITIES: BlockerEntity[] = [
  { label: 'students', entity: Student },
  { label: 'enrolments', entity: Enrollment },
  { label: 'exams', entity: Exam },
  { label: 'fee structures', entity: FeeStructure },
  { label: 'homework', entity: Homework },
  { label: 'syllabus topics', entity: SyllabusTopic },
  { label: 'routine slots', entity: RoutineSlot },
  { label: 'calendar events', entity: CalendarEvent },
  { label: 'promotion runs', entity: PromotionRun },
  { label: 'attendance sessions', entity: AttendanceSession },
];

/** Counts the tenant's non-deleted rows per entity (soft-deleted rows are excluded by TypeORM). */
export async function countRows(
  manager: EntityManager,
  tenantId: string,
  list: BlockerEntity[],
): Promise<{ entity: string; count: number }[]> {
  return Promise.all(
    list.map(async ({ label, entity }) => ({
      entity: label,
      count: await manager.getRepository(entity).count({ where: { tenant_id: tenantId } }),
    })),
  );
}
