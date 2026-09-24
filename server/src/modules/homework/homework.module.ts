import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { HomeworkController } from './homework.controller';
import { HomeworkService } from './homework.service';
import { HomeworkAccessService } from './homework-access.service';

/**
 * [22.2.1] Entities. [22.3.1] added the controller/service/access-service
 * providers below — later wave-3 tickets extend this same module file.
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
  ],
  controllers: [HomeworkController],
  providers: [HomeworkService, HomeworkAccessService],
})
export class HomeworkModule {}
