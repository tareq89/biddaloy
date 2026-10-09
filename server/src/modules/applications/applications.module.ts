import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Application } from './entities/application.entity';
import { ApplicationEvent } from './entities/application-event.entity';
import { ApplicationTag } from './entities/application-tag.entity';
import { ApplicationAttachment } from './entities/application-attachment.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Exam } from '../exams/entities/exam.entity';
import { Subject } from '../academics/entities/subject.entity';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PushModule } from '../push/push.module';
import { CommunicationsModule } from '../communications/communications.module';
import { CreditsModule } from '../communications/credits/credits.module';
import { StorageModule } from '../storage/storage.module';
import { SchoolsModule } from '../schools/schools.module';
import { CalendarModule } from '../calendar/calendar.module';
import { AcademicYearModule } from '../academics/academic-year.module';
import { ClassModule } from '../classes/classes.module';
import { StudentModule } from '../students/students.module';
import { StaffProfilesModule } from '../staff-profiles/staff-profiles.module';
import { LeaveModule } from '../leave/leave.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { StaffAttendanceModule } from '../staff-attendance/staff-attendance.module';
import { FeeModule } from '../fees/fees.module';
import { EnrollmentModule } from '../enrollments/enrollments.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { ApplicationAttachmentsController } from './application-attachments.controller';
import { ApplicationAttachmentsService } from './application-attachments.service';
import { ApplicationDecisionsController } from './application-decisions.controller';
import { ApplicationDecisionsService } from './application-decisions.service';
import { ApplicationReportsController } from './application-reports.controller';
import { ApplicationReportsService } from './application-reports.service';
import { ApplicationLetterService } from './application-letter.service';
import { ApplicationNotifyService } from './application-notify.service';
import { ReviewerScopeService } from './reviewer-scope';
import { StaffLeaveHandler } from './handlers/staff-leave.handler';
import { StudentLeaveHandler } from './handlers/student-leave.handler';
import { FeeWaiverHandler } from './handlers/fee-waiver.handler';
import { ReadmissionHandler } from './handlers/readmission.handler';
import { SectionChangeHandler } from './handlers/section-change.handler';
import { TransferCertificateHandler } from './handlers/transfer-certificate.handler';
import { ManualHandler } from './handlers/manual.handler';

/**
 * [52.1.5] Applications (আবেদনপত্র). Skeleton: every provider, controller and imported
 * module the later Epic 52 tickets need is registered here, so none of them edits this file
 * or app.module.ts. A leaf module (nothing imports it), so no forwardRef is expected.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Application,
      ApplicationEvent,
      ApplicationTag,
      ApplicationAttachment,
      Student,
      Guardian,
      StaffProfile,
      Teacher,
      TeacherClassSection,
      ClassSection,
      Exam,
      Subject,
      User,
      UserTenant,
      AcademicYear,
    ]),
    AuditModule,
    AuthModule,
    PushModule,
    CommunicationsModule,
    CreditsModule,
    StorageModule,
    SchoolsModule,
    CalendarModule,
    AcademicYearModule,
    ClassModule,
    StudentModule,
    StaffProfilesModule,
    LeaveModule,
    AttendanceModule,
    StaffAttendanceModule,
    FeeModule,
    EnrollmentModule,
  ],
  providers: [
    ApplicationsService,
    ApplicationDecisionsService,
    ApplicationReportsService,
    ApplicationAttachmentsService,
    ApplicationLetterService,
    ApplicationNotifyService,
    ReviewerScopeService,
    StaffLeaveHandler,
    StudentLeaveHandler,
    FeeWaiverHandler,
    ReadmissionHandler,
    SectionChangeHandler,
    TransferCertificateHandler,
    ManualHandler,
  ],
  // Express matches in registration order: the static paths (/applications/pending-count,
  // /reports, /bulk-approve) must register before ApplicationsController's GET /applications/:id.
  controllers: [
    ApplicationReportsController,
    ApplicationDecisionsController,
    ApplicationAttachmentsController,
    ApplicationsController,
  ],
  exports: [ApplicationNotifyService, ReviewerScopeService],
})
export class ApplicationsModule {}
