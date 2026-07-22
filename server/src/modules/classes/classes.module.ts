import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { ClassService, SectionService } from './classes.service';
import { ClassController } from './classes.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Class, ClassSection, Student])],
  providers: [ClassService, SectionService],
  controllers: [ClassController],
  exports: [ClassService, SectionService],
})
export class ClassModule {}