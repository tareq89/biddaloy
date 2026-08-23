import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYear } from './entities/academic-year.entity';
import { Class } from './entities/class.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { AcademicYearService } from './academic-year.service';
import { AcademicYearController } from './academic-year.controller';

@Module({
  // Class/Enrollment/FeeStructure are registered entity-only (no
  // StudentsModule/FeesModule import) so AcademicYearService can count
  // against them for `getStats` without a cross-module DI cycle.
  imports: [TypeOrmModule.forFeature([AcademicYear, Class, Enrollment, FeeStructure])],
  providers: [AcademicYearService],
  controllers: [AcademicYearController],
  exports: [AcademicYearService],
})
export class AcademicYearModule {}
