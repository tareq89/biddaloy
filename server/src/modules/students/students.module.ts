import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { Enrollment } from './entities/enrollment.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditModule } from '../audit/audit.module';
import { StudentService, GuardianService } from './students.service';
import { StudentBulkUploadService } from './bulk-upload.service';
import { StudentController } from './students.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Student, Guardian, Enrollment, ClassSection, Class, AcademicYear]),
    AuditModule,
  ],
  providers: [StudentService, GuardianService, StudentBulkUploadService],
  controllers: [StudentController],
  exports: [StudentService, GuardianService, StudentBulkUploadService],
})
export class StudentModule {}