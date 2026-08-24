import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Student } from '../students/entities/student.entity';
import { ClassService, SectionService } from './classes.service';
import { ClassController } from './classes.controller';

@Module({
  // Teacher/TeacherClassSection/Student are registered entity-only (no
  // StudentsModule/AcademicsModule import) — same reasoning as
  // `academic-year.module.ts`'s own comment: ClassService/SectionService
  // need to count/join against them ([8.11.2]'s delete guard, enrolled
  // counts, and the read-only teachers tab) without a cross-module DI
  // cycle. `Enrollment` is not injected by either service — the delete
  // guard and the section enrolled-count both count `Student` (joined
  // through `class_section`), since `POST /students` never writes an
  // `Enrollment` row (see `classes.service.ts`'s comments).
  imports: [TypeOrmModule.forFeature([Class, ClassSection, Teacher, TeacherClassSection, Student])],
  providers: [ClassService, SectionService],
  controllers: [ClassController],
  exports: [ClassService, SectionService],
})
export class ClassModule {}
