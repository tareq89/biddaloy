import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYear } from './entities/academic-year.entity';
import { AcademicYearService } from './academic-year.service';
import { AcademicYearController } from './academic-year.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AcademicYear])],
  providers: [AcademicYearService],
  controllers: [AcademicYearController],
  exports: [AcademicYearService],
})
export class AcademicYearModule {}