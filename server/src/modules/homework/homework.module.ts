import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';

/**
 * [22.2.1] Entities only — services/controllers land in wave 3 tickets
 * that extend this same module file.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Homework, HomeworkAssignment, HomeworkSubmission, SyllabusTopic]),
  ],
})
export class HomeworkModule {}
