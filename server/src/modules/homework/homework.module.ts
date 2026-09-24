import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { StudentModule } from '../students/students.module';
import { StorageModule } from '../storage/storage.module';
import { HomeworkController } from './homework.controller';
import { HomeworkService } from './homework.service';
import { HomeworkAccessService } from './homework-access.service';
import { HomeworkSubmissionController } from './homework-submission.controller';
import { HomeworkSubmissionService } from './homework-submission.service';

/**
 * [22.2.1] Entities. [22.3.1] added the controller/service/access-service
 * providers below — later wave-3 tickets extend this same module file.
 * [22.3.2] added the submission controller/service — `StudentModule` for
 * `FamilyAccessService` (D26 ownership scoping) and `StorageModule` for
 * `StorageService` (attachment uploads, same pattern as `logo.controller.ts`).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Homework,
      HomeworkAssignment,
      HomeworkSubmission,
      SyllabusTopic,
      TeacherClassSection,
      ClassSection,
      Student,
    ]),
    StudentModule,
    StorageModule,
  ],
  controllers: [HomeworkController, HomeworkSubmissionController],
  providers: [HomeworkService, HomeworkAccessService, HomeworkSubmissionService],
})
export class HomeworkModule {}
