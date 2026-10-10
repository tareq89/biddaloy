import { Module } from '@nestjs/common';
import { ExamsMarksOverdueRule } from './exams-marks-overdue.rule';
import { ExamsMyMarksDueRule } from './exams-my-marks-due.rule';
import { ExamsResultsUnpublishedRule } from './exams-results-unpublished.rule';
import { ExamsScheduleUnpublishedRule } from './exams-schedule-unpublished.rule';
import { ExamsSeatPlanMissingRule } from './exams-seat-plan-missing.rule';

/** Rules of category EXAMS. */
@Module({
  providers: [
    ExamsMarksOverdueRule,
    ExamsMyMarksDueRule,
    ExamsResultsUnpublishedRule,
    ExamsScheduleUnpublishedRule,
    ExamsSeatPlanMissingRule,
  ],
})
export class ExamsRulesModule {}
