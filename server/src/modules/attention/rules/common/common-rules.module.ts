import { Module } from '@nestjs/common';
import { StudentModule } from '../../../students/students.module';
import { CalendarHolidayTomorrowRule } from './calendar-holiday-tomorrow.rule';
import { SurveysPendingRule } from './surveys-pending.rule';

/** Rules of category COMMON. */
@Module({
  imports: [StudentModule],
  providers: [CalendarHolidayTomorrowRule, SurveysPendingRule],
})
export class CommonRulesModule {}
