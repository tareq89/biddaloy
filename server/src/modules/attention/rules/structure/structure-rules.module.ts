import { Module } from '@nestjs/common';
import { RoutineNotPublishedRule } from './routine-not-published.rule';
import { SectionNoClassTeacherRule } from './section-no-class-teacher.rule';
import { RoutineSubjectNoTeacherRule } from './routine-subject-no-teacher.rule';
import { GuardianContactMissingRule } from './guardian-contact-missing.rule';

/** Rules of category STRUCTURE (DataSource only, no imports needed). */
@Module({
  providers: [
    RoutineNotPublishedRule,
    SectionNoClassTeacherRule,
    RoutineSubjectNoTeacherRule,
    GuardianContactMissingRule,
  ],
})
export class StructureRulesModule {}
