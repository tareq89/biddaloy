import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { Class } from '../academics/entities/class.entity';
import { Subject } from '../academics/entities/subject.entity';
import { AuditModule } from '../audit/audit.module';
import { SyllabusService } from './syllabus.service';
import { SyllabusController } from './syllabus.controller';

/**
 * [22.2.1] Entities only, extended in wave 3 by [22.3.4]'s syllabus
 * provider/controller pair — later wave-3 tickets append to this same
 * module file (known accepted cross-lane risk, resolved at integration).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Homework,
      HomeworkAssignment,
      HomeworkSubmission,
      SyllabusTopic,
      Class,
      Subject,
    ]),
    AuditModule,
  ],
  controllers: [SyllabusController],
  providers: [SyllabusService],
})
export class HomeworkModule {}
