import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { Enrollment } from './entities/enrollment.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { StudentService, GuardianService } from './students.service';
import { StudentController } from './students.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Student, Guardian, Enrollment, ClassSection])],
  providers: [StudentService, GuardianService],
  controllers: [StudentController],
  exports: [StudentService, GuardianService],
})
export class StudentModule {}