import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { EnrollmentService } from './enrollments.service';
import { EnrollmentController } from './enrollments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Enrollment, Student, Class])],
  providers: [EnrollmentService],
  controllers: [EnrollmentController],
  exports: [EnrollmentService],
})
export class EnrollmentModule {}