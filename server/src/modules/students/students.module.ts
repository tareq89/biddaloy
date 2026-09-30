import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { Enrollment } from './entities/enrollment.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditModule } from '../audit/audit.module';
// `BulkImportModule` is `@Global()`, so `ImportStagingService` is already
// injectable without this — imported anyway so the dependency is visible
// here rather than only discoverable by reading `bulk-upload.service.ts`.
import { BulkImportModule } from '../bulk-import/bulk-import.module';
import { EnrollmentModule } from '../enrollments/enrollments.module';
import { StudentService, GuardianService } from './students.service';
import { StudentBulkUploadService } from './bulk-upload.service';
import { FamilyAccessService } from './family-access.service';
import { StudentController } from './students.controller';
import { StudentLifecycleEvent } from './entities/student-lifecycle-event.entity';
import { StudentNote } from './entities/student-note.entity';
import { StudentPublicExam } from './entities/student-public-exam.entity';
import { StudentLifecycleService } from './student-lifecycle.service';
import { StudentLifecycleController } from './student-lifecycle.controller';
import { StudentNotesService } from './student-notes.service';
import { StudentNotesController } from './student-notes.controller';
import { StudentPublicExamsService } from './student-public-exams.service';
import { StudentPublicExamsController } from './student-public-exams.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Student,
      Guardian,
      Enrollment,
      ClassSection,
      Class,
      AcademicYear,
      StudentLifecycleEvent,
      StudentNote,
      StudentPublicExam,
    ]),
    AuditModule,
    BulkImportModule,
    // Pre-wired so W2's lifecycle service can inject `EnrollmentService`
    // without reopening this file (D29).
    EnrollmentModule,
  ],
  providers: [
    StudentService,
    GuardianService,
    StudentBulkUploadService,
    FamilyAccessService,
    StudentLifecycleService,
    StudentNotesService,
    StudentPublicExamsService,
  ],
  controllers: [
    StudentController,
    StudentLifecycleController,
    StudentNotesController,
    StudentPublicExamsController,
  ],
  exports: [
    StudentService,
    GuardianService,
    StudentBulkUploadService,
    FamilyAccessService,
    StudentLifecycleService,
  ],
})
export class StudentModule {}
