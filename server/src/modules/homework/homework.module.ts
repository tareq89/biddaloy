import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Subject } from '../academics/entities/subject.entity';
// `BulkImportModule` is `@Global()`, so `ImportStagingService` is already
// injectable without this — imported anyway for visibility (same note as
// students/students.module.ts).
import { BulkImportModule } from '../bulk-import/bulk-import.module';
import { HomeworkBulkUploadService } from './homework-bulk-upload.service';
import { HomeworkBulkUploadController } from './homework-bulk-upload.controller';

/**
 * [22.2.1] Entities only — services/controllers land in wave 3 tickets
 * that extend this same module file.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Homework,
      HomeworkAssignment,
      HomeworkSubmission,
      SyllabusTopic,
      Class,
      ClassSection,
      AcademicYear,
      Subject,
    ]),
    BulkImportModule,
  ],
  providers: [HomeworkBulkUploadService],
  controllers: [HomeworkBulkUploadController],
})
export class HomeworkModule {}
