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
import { StudentService, GuardianService } from './students.service';
import { StudentBulkUploadService } from './bulk-upload.service';
import { FamilyAccessService } from './family-access.service';
import { StudentController } from './students.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Student, Guardian, Enrollment, ClassSection, Class, AcademicYear]),
    AuditModule,
    BulkImportModule,
  ],
  providers: [StudentService, GuardianService, StudentBulkUploadService, FamilyAccessService],
  controllers: [StudentController],
  exports: [StudentService, GuardianService, StudentBulkUploadService, FamilyAccessService],
})
export class StudentModule {}
