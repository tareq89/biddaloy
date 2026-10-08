import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { StudyPlan } from './entities/study-plan.entity';
import { LessonDelivery } from './entities/lesson-delivery.entity';
import { StudyPlanTemplate } from './entities/study-plan-template.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Subject } from '../academics/entities/subject.entity';
import { SyllabusTopic } from '../homework/entities/syllabus-topic.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Routine } from '../routines/entities/routine.entity';
import { RoutineSlot } from '../routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from '../routines/entities/routine-substitution.entity';
import { PeriodSlot } from '../routines/entities/period-slot.entity';
import { LeaveRecord } from '../leave/entities/leave-record.entity';
import { Exam } from '../exams/entities/exam.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { School } from '../schools/entities/school.entity';
import { RoutinesModule } from '../routines/routines.module';
import { CalendarModule } from '../calendar/calendar.module';
import { ClassModule } from '../classes/classes.module';
import { StudentModule } from '../students/students.module';
import { SchoolsModule } from '../schools/schools.module';
import { PushModule } from '../push/push.module';
import { CommunicationsModule } from '../communications/communications.module';
import { CreditsModule } from '../communications/credits/credits.module';
import { AuditModule } from '../audit/audit.module';
import { StudyPlansController } from './study-plans.controller';
import { LessonDeliveriesController } from './lesson-deliveries.controller';
import { StudyPlanTemplatesController } from './study-plan-templates.controller';
import { FamilyStudyPlansController } from './family-study-plans.controller';
import { StudyPlansService } from './study-plans.service';
import { PlanScheduleService } from './plan-schedule.service';
import { LessonDeliveriesService } from './lesson-deliveries.service';
import { StudyPlanTemplatesService } from './study-plan-templates.service';
import { StudyPlanCsvService } from './study-plan-csv.service';
import {
  StudyPlanAutoDeliveriesScheduler,
  STUDY_PLAN_AUTO_DELIVERIES_QUEUE,
} from './study-plan-auto-deliveries.scheduler';
import { StudyPlanFlagsScheduler, STUDY_PLAN_FLAGS_QUEUE } from './study-plan-flags.scheduler';

/**
 * [66.2.01/#2006] Every wave-2 provider/controller is registered here now, so
 * the later tickets only fill in their own files and never edit this module.
 * If one finds a provider missing, 66.2.99 adds it.
 * `BulkImportModule` is `@Global()`, so it is not imported. No imported module
 * imports homework or study-plans, so there is no cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StudyPlan,
      LessonDelivery,
      StudyPlanTemplate,
      AcademicYear,
      AcademicTerm,
      Class,
      ClassSection,
      ClassSubject,
      Subject,
      SyllabusTopic,
      Teacher,
      TeacherClassSection,
      Routine,
      RoutineSlot,
      RoutineSlotTeacher,
      RoutineSubstitution,
      PeriodSlot,
      LeaveRecord,
      Exam,
      Student,
      Guardian,
      UserTenant,
      School,
    ]),
    RoutinesModule,
    CalendarModule,
    ClassModule,
    StudentModule,
    SchoolsModule,
    PushModule,
    CommunicationsModule,
    CreditsModule,
    AuditModule,
    BullModule.registerQueue(
      { name: STUDY_PLAN_AUTO_DELIVERIES_QUEUE },
      { name: STUDY_PLAN_FLAGS_QUEUE },
    ),
  ],
  controllers: [
    StudyPlansController,
    LessonDeliveriesController,
    StudyPlanTemplatesController,
    FamilyStudyPlansController,
  ],
  providers: [
    StudyPlansService,
    PlanScheduleService,
    LessonDeliveriesService,
    StudyPlanTemplatesService,
    StudyPlanCsvService,
    StudyPlanAutoDeliveriesScheduler,
    StudyPlanFlagsScheduler,
  ],
  exports: [StudyPlansService, PlanScheduleService],
})
export class StudyPlansModule {}
