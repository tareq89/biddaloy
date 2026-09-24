import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { StudentModule } from '../students/students.module';
import { StorageModule } from '../storage/storage.module';
import { SchoolsModule } from '../schools/schools.module';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
// `BulkImportModule` is `@Global()`, so `ImportStagingService` is already
// injectable without this — imported anyway for visibility (same note as
// students/students.module.ts).
import { BulkImportModule } from '../bulk-import/bulk-import.module';
import { HomeworkController } from './homework.controller';
import { HomeworkService } from './homework.service';
import { HomeworkAccessService } from './homework-access.service';
import { HomeworkSubmissionController } from './homework-submission.controller';
import { HomeworkSubmissionService } from './homework-submission.service';
import { HomeworkNoticeService } from './homework-notice.service';
import {
  HomeworkDefaulterScheduler,
  HOMEWORK_DEFAULTER_SWEEP_QUEUE,
} from './homework-defaulter.scheduler';
import { HomeworkBulkUploadService } from './homework-bulk-upload.service';
import { HomeworkBulkUploadController } from './homework-bulk-upload.controller';

/**
 * [22.2.1] Entities. [22.3.1] added the controller/service/access-service
 * providers below — later wave-3 tickets extend this same module file.
 * [22.3.2] added the submission controller/service — `StudentModule` for
 * `FamilyAccessService` (D26 ownership scoping) and `StorageModule` for
 * `StorageService` (attachment uploads, same pattern as `logo.controller.ts`).
 * [22.3.3] adds `HomeworkNoticeService`/`HomeworkDefaulterScheduler` —
 * `CommunicationLog` registered directly (not via `CommunicationsModule`)
 * and `COMMUNICATIONS_QUEUE` registered as a producer, same pattern as
 * `AttendanceModule`'s `AbsenceNoticeService`/`AbsenceNoticeScheduler`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Homework,
      HomeworkAssignment,
      HomeworkSubmission,
      SyllabusTopic,
      TeacherClassSection,
      Class,
      ClassSection,
      AcademicYear,
      Subject,
      Student,
      CommunicationLog,
    ]),
    StudentModule,
    StorageModule,
    SchoolsModule,
    BulkImportModule,
    BullModule.registerQueue({
      name: COMMUNICATIONS_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),
    BullModule.registerQueue({ name: HOMEWORK_DEFAULTER_SWEEP_QUEUE }),
  ],
  controllers: [
    HomeworkController,
    HomeworkSubmissionController,
    HomeworkBulkUploadController,
  ],
  providers: [
    HomeworkService,
    HomeworkAccessService,
    HomeworkSubmissionService,
    HomeworkNoticeService,
    HomeworkDefaulterScheduler,
    HomeworkBulkUploadService,
  ],
})
export class HomeworkModule {}
