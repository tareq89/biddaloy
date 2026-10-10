import { Module } from '@nestjs/common';
import { RoutinesModule } from '../../../routines/routines.module';
import { ClassStartingRule } from './class-starting.rule';
import { RoutineSubstitutionTodayRule } from './routine-substitution-today.rule';
import { RoutineUncoveredPeriodsRule } from './routine-uncovered-periods.rule';

/** Rules of category PERIOD. */
@Module({
  imports: [RoutinesModule],
  providers: [ClassStartingRule, RoutineSubstitutionTodayRule, RoutineUncoveredPeriodsRule],
})
export class PeriodRulesModule {}
