import { DataSource } from 'typeorm';
import {
  EnrollmentStatus,
  ExamComponentKind,
  ExamKind,
  FeeType,
  MarkStatus,
  PeriodSlotKind,
  RoutineState,
  SeatOrderMode,
  SlotRecurrence,
} from '@biddaloy/shared';
import { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
import { Class } from '../src/modules/academics/entities/class.entity';
import { ClassSection } from '../src/modules/academics/entities/class-section.entity';
import { Subject } from '../src/modules/academics/entities/subject.entity';
import { Student } from '../src/modules/students/entities/student.entity';
import { Enrollment } from '../src/modules/students/entities/enrollment.entity';
import { FeeStructure } from '../src/modules/fees/entities/fee-structure.entity';
import { StudentFee } from '../src/modules/fees/entities/student-fee.entity';
import { Exam } from '../src/modules/exams/entities/exam.entity';
import { ExamComponent } from '../src/modules/exams/entities/exam-component.entity';
import { ExamSchedule } from '../src/modules/exams/entities/exam-schedule.entity';
import { Mark } from '../src/modules/exams/entities/mark.entity';
import { Result } from '../src/modules/exams/entities/result.entity';
import { GradingScale } from '../src/modules/grading/entities/grading-scale.entity';
import { Room } from '../src/modules/routines/entities/room.entity';
import { Routine } from '../src/modules/routines/entities/routine.entity';
import { RoutineSlot } from '../src/modules/routines/entities/routine-slot.entity';
import { Shift } from '../src/modules/routines/entities/shift.entity';
import { PeriodSlot } from '../src/modules/routines/entities/period-slot.entity';
import { SeatPlan } from '../src/modules/seat-plans/entities/seat-plan.entity';
import { SeatAllocation } from '../src/modules/seat-plans/entities/seat-allocation.entity';
import type { AcademicYearService } from '../src/modules/academics/academic-year.service';
import type { ClassService, SectionService } from '../src/modules/classes/classes.service';
import type { SubjectService } from '../src/modules/academics/subjects.service';
import type { RoomsService } from '../src/modules/routines/rooms.service';
import type { GradingService } from '../src/modules/grading/grading.service';

/**
 * Delete-guard registry (#2655, D19'). Every many-to-one that points at one
 * of seven protected parents sits in exactly one of three lists. The spec
 * `delete-guard-registry.integration.spec.ts` fails when a relation is in none
 * of them (or a list names a relation that no longer exists).
 *
 * Key format: "Child.relationProperty -> Parent".
 *
 * Soft delete never fires `ON DELETE CASCADE`, so a CASCADE flag on the
 * relation is not a reason to skip a guard.
 *
 *   GUARDED     parent remove() answers 409 while a live child exists (proved).
 *   ALLOWED     remove() deals with the child itself; `reason` names the code.
 *   KNOWN_GAPS  no guard yet; each becomes a GitHub issue at wave close (D22).
 */

export interface Ctx {
  ds: DataSource;
  tenantId: string;
  svc: {
    academicYears: AcademicYearService;
    classes: ClassService;
    sections: SectionService;
    subjects: SubjectService;
    rooms: RoomsService;
    grading: GradingService;
  };
  /** Unique number per call, so names/codes never collide inside one school. */
  n(): number;
}

export type ParentKind =
  'AcademicYear' | 'Class' | 'ClassSection' | 'Subject' | 'Room' | 'GradingScale';

/** Saves one live child row; `release` soft-deletes it (or deletes it when the table has no soft delete). */
export interface MadeChild {
  release(): Promise<void>;
}

export interface Guarded {
  key: string;
  parent: ParentKind;
  softDeletable: boolean;
  makeChild(ctx: Ctx, parentId: string): Promise<MadeChild>;
}

export interface Allowed {
  key: string;
  reason: string;
}

export interface KnownGap {
  key: string;
  reason: string;
  followUp: number;
}


// ---- fixtures ---------------------------------------------------------------

const day = (n: number) => `${2000 + (n % 90)}-01-01`;

async function year(ctx: Ctx) {
  const n = ctx.n();
  return ctx.ds.getRepository(AcademicYear).save({
    name: `Y-${n}`,
    start_date: new Date(day(n)),
    end_date: new Date(`${2000 + (n % 90)}-12-31`),
    tenant_id: ctx.tenantId,
  });
}

async function klass(ctx: Ctx, academicYearId: string) {
  return ctx.ds
    .getRepository(Class)
    .save({ name: `C-${ctx.n()}`, academic_year_id: academicYearId, tenant_id: ctx.tenantId });
}

async function section(ctx: Ctx, classId: string) {
  return ctx.ds
    .getRepository(ClassSection)
    .save({ class_id: classId, section_name: `S-${ctx.n()}`, tenant_id: ctx.tenantId });
}

async function student(ctx: Ctx, sectionId: string) {
  const n = ctx.n();
  return ctx.ds.getRepository(Student).save({
    full_name: `Guard Student ${n}`,
    registration_number: `REG-GUARD-${n}`,
    roll_number: n,
    class_section_id: sectionId,
    tenant_id: ctx.tenantId,
  });
}

async function subject(ctx: Ctx) {
  const n = ctx.n();
  return ctx.ds
    .getRepository(Subject)
    .save({ name_en: `Subject ${n}`, code: `SUB-${n}`, tenant_id: ctx.tenantId });
}

/** A year, class, section and student that belong to no parent under test. */
async function host(ctx: Ctx) {
  const y = await year(ctx);
  const k = await klass(ctx, y.id);
  const s = await section(ctx, k.id);
  const st = await student(ctx, s.id);
  return { year: y, klass: k, section: s, student: st };
}

async function exam(ctx: Ctx, academicYearId: string, classId: string) {
  return ctx.ds.getRepository(Exam).save({
    tenant_id: ctx.tenantId,
    academic_year_id: academicYearId,
    class_id: classId,
    name: `Exam ${ctx.n()}`,
    kind: ExamKind.TERM,
  });
}

const softDelete = (ctx: Ctx, entity: new () => object, id: string) => async () => {
  await ctx.ds.getRepository(entity).softDelete({ id } as never);
};
const hardDelete = (ctx: Ctx, entity: new () => object, id: string) => async () => {
  await ctx.ds.getRepository(entity).delete({ id } as never);
};

// ---- parents ----------------------------------------------------------------

export const PARENTS: Record<
  ParentKind,
  {
    make(ctx: Ctx): Promise<string>;
    remove(ctx: Ctx, id: string): Promise<unknown>;
    /** True once the parent row is soft-deleted. */
    isGone(ctx: Ctx, id: string): Promise<boolean>;
  }
> = {
  AcademicYear: {
    make: async (ctx) => (await year(ctx)).id,
    remove: (ctx, id) => ctx.svc.academicYears.remove(id, ctx.tenantId),
    isGone: async (ctx, id) => goneIn(ctx, AcademicYear, id),
  },
  Class: {
    make: async (ctx) => (await klass(ctx, (await year(ctx)).id)).id,
    remove: (ctx, id) => ctx.svc.classes.remove(id, ctx.tenantId),
    isGone: async (ctx, id) => goneIn(ctx, Class, id),
  },
  ClassSection: {
    make: async (ctx) => (await section(ctx, (await klass(ctx, (await year(ctx)).id)).id)).id,
    remove: async (ctx, id) => {
      const s = await ctx.ds.getRepository(ClassSection).findOneByOrFail({ id });
      return ctx.svc.sections.remove(s.class_id, id, ctx.tenantId);
    },
    isGone: async (ctx, id) => goneIn(ctx, ClassSection, id),
  },
  Subject: {
    make: async (ctx) => (await subject(ctx)).id,
    remove: (ctx, id) => ctx.svc.subjects.remove(id, ctx.tenantId),
    isGone: async (ctx, id) => goneIn(ctx, Subject, id),
  },
  Room: {
    make: async (ctx) =>
      (await ctx.ds.getRepository(Room).save({ room_no: `R-${ctx.n()}`, tenant_id: ctx.tenantId }))
        .id,
    remove: (ctx, id) => ctx.svc.rooms.remove(id, ctx.tenantId),
    isGone: async (ctx, id) => goneIn(ctx, Room, id),
  },
  GradingScale: {
    make: async (ctx) =>
      (
        await ctx.ds.getRepository(GradingScale).save({
          name: `Scale ${ctx.n()}`,
          academic_year_id: (await year(ctx)).id,
          tenant_id: ctx.tenantId,
        })
      ).id,
    remove: (ctx, id) => ctx.svc.grading.remove(id, ctx.tenantId, null),
    isGone: async (ctx, id) => goneIn(ctx, GradingScale, id),
  },
};

async function goneIn(ctx: Ctx, entity: new () => object, id: string): Promise<boolean> {
  const row = await ctx.ds
    .getRepository(entity)
    .findOne({ where: { id } as never, withDeleted: true });
  return !!row && (row as { deleted_at?: Date | null }).deleted_at != null;
}

// ---- GUARDED ----------------------------------------------------------------

export const GUARDED: Guarded[] = [
  {
    key: 'Class.academic_year -> AcademicYear',
    parent: 'AcademicYear',
    softDeletable: true,
    async makeChild(ctx, yearId) {
      const c = await klass(ctx, yearId);
      return { release: softDelete(ctx, Class, c.id) };
    },
  },
  {
    key: 'FeeStructure.academic_year -> AcademicYear',
    parent: 'AcademicYear',
    softDeletable: true,
    async makeChild(ctx, yearId) {
      const h = await host(ctx);
      const fs = await ctx.ds.getRepository(FeeStructure).save({
        fee_type: FeeType.MONTHLY_TUITION,
        name: `Tuition ${ctx.n()}`,
        amount: 500,
        class_id: h.klass.id,
        academic_year_id: yearId,
        tenant_id: ctx.tenantId,
      });
      return { release: softDelete(ctx, FeeStructure, fs.id) };
    },
  },
  {
    key: 'Enrollment.academic_year -> AcademicYear',
    parent: 'AcademicYear',
    softDeletable: false,
    async makeChild(ctx, yearId) {
      const h = await host(ctx);
      const e = await ctx.ds.getRepository(Enrollment).save({
        student_id: h.student.id,
        class_id: h.klass.id,
        section_id: h.section.id,
        academic_year_id: yearId,
        tenant_id: ctx.tenantId,
        enrollment_status: EnrollmentStatus.GRADUATED,
      });
      return { release: hardDelete(ctx, Enrollment, e.id) };
    },
  },
  {
    key: 'Exam.academic_year -> AcademicYear',
    parent: 'AcademicYear',
    softDeletable: true,
    async makeChild(ctx, yearId) {
      const h = await host(ctx);
      const e = await exam(ctx, yearId, h.klass.id);
      return { release: softDelete(ctx, Exam, e.id) };
    },
  },
  {
    key: 'StudentFee.academic_year -> AcademicYear',
    parent: 'AcademicYear',
    softDeletable: true,
    async makeChild(ctx, yearId) {
      const h = await host(ctx);
      const fs = await ctx.ds.getRepository(FeeStructure).save({
        fee_type: FeeType.MONTHLY_TUITION,
        name: `Tuition ${ctx.n()}`,
        amount: 500,
        class_id: h.klass.id,
        academic_year_id: h.year.id,
        tenant_id: ctx.tenantId,
      });
      const bill = await ctx.ds.getRepository(StudentFee).save({
        student_id: h.student.id,
        academic_year_id: yearId,
        fee_structure_id: fs.id,
        period_start: new Date('2022-02-01'),
        total_amount: 500,
      });
      return { release: softDelete(ctx, StudentFee, bill.id) };
    },
  },
  {
    key: 'ClassSection.class -> Class',
    parent: 'Class',
    softDeletable: true,
    async makeChild(ctx, classId) {
      const s = await section(ctx, classId);
      return { release: softDelete(ctx, ClassSection, s.id) };
    },
  },
  {
    key: 'Enrollment.class -> Class',
    parent: 'Class',
    softDeletable: false,
    async makeChild(ctx, classId) {
      const h = await host(ctx);
      const e = await ctx.ds.getRepository(Enrollment).save({
        student_id: h.student.id,
        class_id: classId,
        section_id: null,
        academic_year_id: h.year.id,
        tenant_id: ctx.tenantId,
        enrollment_status: EnrollmentStatus.GRADUATED,
      });
      return { release: hardDelete(ctx, Enrollment, e.id) };
    },
  },
  {
    key: 'Student.class_section -> ClassSection',
    parent: 'ClassSection',
    softDeletable: true,
    async makeChild(ctx, sectionId) {
      const s = await student(ctx, sectionId);
      return { release: softDelete(ctx, Student, s.id) };
    },
  },
  {
    key: 'Enrollment.section -> ClassSection',
    parent: 'ClassSection',
    softDeletable: false,
    async makeChild(ctx, sectionId) {
      const h = await host(ctx);
      const sec = await ctx.ds.getRepository(ClassSection).findOneByOrFail({ id: sectionId });
      const e = await ctx.ds.getRepository(Enrollment).save({
        student_id: h.student.id,
        class_id: sec.class_id,
        section_id: sectionId,
        academic_year_id: h.year.id,
        tenant_id: ctx.tenantId,
        enrollment_status: EnrollmentStatus.GRADUATED,
      });
      return { release: hardDelete(ctx, Enrollment, e.id) };
    },
  },
  {
    key: 'ExamComponent.subject -> Subject',
    parent: 'Subject',
    softDeletable: true,
    async makeChild(ctx, subjectId) {
      const h = await host(ctx);
      const e = await exam(ctx, h.year.id, h.klass.id);
      const c = await ctx.ds.getRepository(ExamComponent).save({
        tenant_id: ctx.tenantId,
        exam_id: e.id,
        subject_id: subjectId,
        name: 'Written',
        kind: ExamComponentKind.WRITTEN,
        full_marks: '100',
        sequence: 1,
      });
      return { release: softDelete(ctx, ExamComponent, c.id) };
    },
  },
  {
    key: 'Mark.subject -> Subject',
    parent: 'Subject',
    softDeletable: false,
    async makeChild(ctx, subjectId) {
      const h = await host(ctx);
      const e = await exam(ctx, h.year.id, h.klass.id);
      const c = await ctx.ds.getRepository(ExamComponent).save({
        tenant_id: ctx.tenantId,
        exam_id: e.id,
        subject_id: (await subject(ctx)).id, // other subject: only the mark may block
        name: 'Written',
        kind: ExamComponentKind.WRITTEN,
        full_marks: '100',
        sequence: 1,
      });
      const m = await ctx.ds.getRepository(Mark).save({
        tenant_id: ctx.tenantId,
        exam_id: e.id,
        student_id: h.student.id,
        subject_id: subjectId,
        component_id: c.id,
        value: '80',
        status: MarkStatus.PRESENT,
      });
      return { release: hardDelete(ctx, Mark, m.id) };
    },
  },
  {
    key: 'RoutineSlot.room -> Room',
    parent: 'Room',
    softDeletable: false,
    async makeChild(ctx, roomId) {
      const h = await host(ctx);
      const subj = await subject(ctx);
      const shift = await ctx.ds.getRepository(Shift).save({
        tenant_id: ctx.tenantId,
        name: `Shift-${ctx.n()}`,
        day_starts_at: '08:00:00',
        day_ends_at: '14:00:00',
        sequence: 0,
      });
      const period = await ctx.ds.getRepository(PeriodSlot).save({
        tenant_id: ctx.tenantId,
        shift_id: shift.id,
        sequence: 0,
        kind: PeriodSlotKind.CLASS,
        starts_at: '08:00:00',
        ends_at: '08:40:00',
      });
      const routine = await ctx.ds.getRepository(Routine).save({
        tenant_id: ctx.tenantId,
        academic_year_id: h.year.id,
        name: `Routine-${ctx.n()}`,
        state: RoutineState.DRAFT,
        published_at: null,
      });
      const slot = await ctx.ds.getRepository(RoutineSlot).save({
        tenant_id: ctx.tenantId,
        routine_id: routine.id,
        section_id: h.section.id,
        period_slot_id: period.id,
        weekday: 1,
        subject_id: subj.id,
        room_id: roomId,
        recurrence: SlotRecurrence.WEEKLY,
        recurrence_offset: 0,
        valid_from: '2026-01-01',
        valid_to: null,
      });
      return { release: hardDelete(ctx, RoutineSlot, slot.id) };
    },
  },
  {
    key: 'SeatAllocation.room -> Room',
    parent: 'Room',
    softDeletable: false,
    async makeChild(ctx, roomId) {
      const h = await host(ctx);
      const subj = await subject(ctx);
      const e = await exam(ctx, h.year.id, h.klass.id);
      const schedule = await ctx.ds.getRepository(ExamSchedule).save({
        tenant_id: ctx.tenantId,
        exam_id: e.id,
        subject_id: subj.id,
        date: '2026-03-01',
        starts_at: '10:00',
        ends_at: '12:00',
      });
      const plan = await ctx.ds.getRepository(SeatPlan).save({
        tenant_id: ctx.tenantId,
        name: `Plan ${ctx.n()}`,
        seat_order_mode: SeatOrderMode.SEQUENTIAL,
      });
      const a = await ctx.ds.getRepository(SeatAllocation).save({
        tenant_id: ctx.tenantId,
        seat_plan_id: plan.id,
        exam_schedule_id: schedule.id,
        student_id: h.student.id,
        room_id: roomId,
        seat_number: '1',
      });
      return { release: hardDelete(ctx, SeatAllocation, a.id) };
    },
  },
  {
    key: 'Result.grading_scale -> GradingScale',
    parent: 'GradingScale',
    softDeletable: true,
    async makeChild(ctx, scaleId) {
      const h = await host(ctx);
      const e = await exam(ctx, h.year.id, h.klass.id);
      const r = await ctx.ds.getRepository(Result).save({
        tenant_id: ctx.tenantId,
        exam_id: e.id,
        student_id: h.student.id,
        total_marks: '80',
        gpa: '4.00',
        grade: 'A',
        grading_scale_id: scaleId,
        grading_scale_revision: 1,
        rule_version: 'test',
        computed_at: new Date(),
      });
      return { release: softDelete(ctx, Result, r.id) };
    },
  },
];

// ---- ALLOWED ----------------------------------------------------------------

export const ALLOWED: Allowed[] = [
  {
    key: 'StudentFee.fee_structure -> FeeStructure',
    reason:
      'FeeStructureService.remove soft-deletes by design (fees.service.ts), so billed history keeps its price tag.',
  },
  {
    key: 'GradingBand.scale -> GradingScale',
    reason:
      "GradingService.remove soft-deletes the scale's bands in the same transaction (grading.service.ts).",
  },
  {
    key: 'ClassSubject.subject -> Subject',
    reason:
      "SubjectService.remove soft-deletes the subject's ClassSubject rows in the same transaction (subjects.service.ts).",
  },
];

// ---- KNOWN_GAPS (each becomes a GitHub issue at wave close, D22) -------------

export const KNOWN_GAPS: KnownGap[] = [
  {
    key: 'ClassSubject.class -> Class',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2676,
  },
  {
    key: 'ClassSubject.academic_year -> AcademicYear',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2675,
  },
  {
    key: 'TeacherClassSection.section -> ClassSection',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2677,
  },
  {
    key: 'TeacherClassSection.subject -> Subject',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2678,
  },
  {
    key: 'AdmissionIntake.class_section -> ClassSection',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2677,
  },
  {
    key: 'Application.academic_year -> AcademicYear',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2675,
  },
  {
    key: 'AttendanceDevice.section -> ClassSection',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2677,
  },
  {
    key: 'AttendanceSession.section -> ClassSection',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2677,
  },
  {
    key: 'AttendanceSession.subject -> Subject',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2678,
  },
  {
    key: 'AcademicTerm.academic_year -> AcademicYear',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2675,
  },
  {
    key: 'CalendarEventClass.class -> Class',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2676,
  },
  {
    key: 'CalendarEvent.academic_year -> AcademicYear',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2675,
  },
  {
    key: 'ExamSchedule.subject -> Subject',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2678,
  },
  {
    key: 'ExamSchedule.room -> Room',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2679,
  },
  {
    key: 'Exam.class -> Class',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2676,
  },
  {
    key: 'MarkGrid.section -> ClassSection',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2677,
  },
  {
    key: 'MarkGrid.subject -> Subject',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2678,
  },
  {
    key: 'ResultSubject.subject -> Subject',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2678,
  },
  {
    key: 'Result.section -> ClassSection',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2677,
  },
  {
    key: 'FeeGeneration.academic_year -> AcademicYear',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2675,
  },
  {
    key: 'FeeStructure.class -> Class',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2676,
  },
  {
    key: 'FeeStructure.section -> ClassSection',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2677,
  },
  {
    key: 'FineRule.academic_year -> AcademicYear',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2675,
  },
  {
    key: 'FineRule.fee_structure -> FeeStructure',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2680,
  },
  {
    key: 'FineRule.class -> Class',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2676,
  },
  {
    key: 'RecurringScheduleStructure.fee_structure -> FeeStructure',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2680,
  },
  {
    key: 'RecurringSchedule.academic_year -> AcademicYear',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2675,
  },
  {
    key: 'GradingScale.academic_year -> AcademicYear',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2675,
  },
  {
    key: 'GradingScale.class -> Class',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2676,
  },
  {
    key: 'HomeworkAssignment.section -> ClassSection',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2677,
  },
  {
    key: 'Homework.subject -> Subject',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2678,
  },
  {
    key: 'Homework.klass -> Class',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2676,
  },
  {
    key: 'SyllabusTopic.klass -> Class',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2676,
  },
  {
    key: 'SyllabusTopic.subject -> Subject',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2678,
  },
  {
    key: 'PromotionRun.source_class -> Class',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2676,
  },
  {
    key: 'RoutineSlot.section -> ClassSection',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2677,
  },
  {
    key: 'RoutineSlot.subject -> Subject',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2678,
  },
  {
    key: 'Routine.academic_year -> AcademicYear',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2675,
  },
  {
    key: 'StudentLifecycleEvent.academic_year -> AcademicYear',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2675,
  },
  {
    key: 'StudentSubjectChoice.academic_year -> AcademicYear',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2675,
  },
  {
    key: 'LessonDelivery.section -> ClassSection',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2677,
  },
  {
    key: 'LessonDelivery.subject -> Subject',
    reason:
      'Child is history or live data (money, marks, results, attendance, student records, applications) and the parent remove() does not check it.',
    followUp: 2678,
  },
  {
    key: 'StudyPlan.academic_year -> AcademicYear',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2675,
  },
  {
    key: 'StudyPlan.section -> ClassSection',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2677,
  },
  {
    key: 'StudyPlan.subject -> Subject',
    reason:
      'Child is plain config that no remove() hides or checks; a deleted parent leaves a dangling row.',
    followUp: 2678,
  },
];
