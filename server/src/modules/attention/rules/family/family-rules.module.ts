import { Module } from '@nestjs/common';
import { RoutinesModule } from '../../../routines/routines.module';
import { StudentModule } from '../../../students/students.module';
import { ChildAbsentTodayRule } from './child-absent-today.rule';
import { ExamsTomorrowRule } from './exams-tomorrow.rule';
import { FeesDueSoonRule } from './fees-due-soon.rule';
import { FeesOverdueFamilyRule } from './fees-overdue-family.rule';
import { GuardianProfileIncompleteRule } from './guardian-profile-incomplete.rule';
import { ResultsPublishedRule } from './results-published.rule';
import { RoutineChangedTodayRule } from './routine-changed-today.rule';

/** Rules of category FAMILY (parents and students). */
@Module({
  imports: [StudentModule, RoutinesModule],
  providers: [
    ChildAbsentTodayRule,
    FeesDueSoonRule,
    FeesOverdueFamilyRule,
    ExamsTomorrowRule,
    ResultsPublishedRule,
    RoutineChangedTodayRule,
    GuardianProfileIncompleteRule,
  ],
})
export class FamilyRulesModule {}
