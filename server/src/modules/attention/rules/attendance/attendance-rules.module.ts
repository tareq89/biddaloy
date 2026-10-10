import { Module } from '@nestjs/common';
import { RoutinesModule } from '../../../routines/routines.module';
import { SchoolsModule } from '../../../schools/schools.module';
import { AttendanceNotTakenRule } from './attendance-not-taken.rule';

/** Rules of category ATTENDANCE. */
@Module({
  imports: [SchoolsModule, RoutinesModule],
  providers: [AttendanceNotTakenRule],
})
export class AttendanceRulesModule {}
