import { Module } from '@nestjs/common';
import { RoutinesModule } from '../../../routines/routines.module';
import { StudentModule } from '../../../students/students.module';
import { HomeworkNotSubmittedRule } from './homework-not-submitted.rule';
import { HomeworkDueTodayRule } from './homework-due-today.rule';
import { HomeworkDueTomorrowRule } from './homework-due-tomorrow.rule';
import { HomeworkToGradeRule } from './homework-to-grade.rule';

/** Rules of category HOMEWORK. */
@Module({
  imports: [RoutinesModule, StudentModule],
  providers: [
    HomeworkNotSubmittedRule,
    HomeworkDueTodayRule,
    HomeworkDueTomorrowRule,
    HomeworkToGradeRule,
  ],
})
export class HomeworkRulesModule {}
