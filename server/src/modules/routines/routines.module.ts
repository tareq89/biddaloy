import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shift } from './entities/shift.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { Room } from './entities/room.entity';
import { Routine } from './entities/routine.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { RoutineSlotTeacher } from './entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from './entities/routine-substitution.entity';
import { RoutineChangeRequest } from './entities/routine-change-request.entity';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { PeriodSlotsService } from './period-slots.service';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { RoutineService } from './routine.service';
import { RoutineSlotsService } from './routine-slots.service';
import { GreedyFillService } from './greedy-fill.service';
import { RoutineSlotsController } from './routine-slots.controller';
import { ResolveRoutineService } from './resolve-routine.service';
import { ResolveRoutineController } from './resolve-routine.controller';
import { SubstitutionsService } from './substitutions.service';
import { SubstitutionsController } from './substitutions.controller';
import { SchoolsModule } from '../schools/schools.module';
import { CalendarModule } from '../calendar/calendar.module';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Enrollment } from '../students/entities/enrollment.entity';

/**
 * [21.2.1] registers the eight class-routine/timetable tables with
 * TypeORM. [21.3.1] adds the setup layer — shifts, period slots, rooms —
 * on top. [21.4.1] adds routine-building: `RoutineSlot` writes, the pure
 * `constraint-check.ts` both the write path and `GreedyFillService`
 * share, and the greedy-fill proposer.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Shift,
      PeriodSlot,
      Room,
      Routine,
      RoutineSlot,
      RoutineSlotTeacher,
      RoutineSubstitution,
      RoutineChangeRequest,
      // Cross-module reads only ([21.4.1]'s constraint checks and
      // greedy-fill candidate selection) — same pattern as
      // `AttendanceModule`'s direct `forFeature` on these entities.
      ClassSection,
      Class,
      TeacherClassSection,
      // [21.5.1] `ResolveRoutineService`'s cross-module reads: academic
      // year boundaries and a student's active enrollment/section.
      AcademicYear,
      Enrollment,
    ]),
    // `SchoolSettingsReader` reads `TenantSettings.routine` — same
    // reasoning as `ClassModule`'s import of `SchoolsModule`.
    SchoolsModule,
    // [21.5.1] `ResolveRoutineService` delegates weekly-off/holiday
    // exclusion to `SchoolCalendarService` — the one definition of "is
    // this a school day" (see that module's own docstring) — rather than
    // re-implementing it here.
    CalendarModule,
  ],
  providers: [
    ShiftsService,
    PeriodSlotsService,
    RoomsService,
    RoutineService,
    RoutineSlotsService,
    GreedyFillService,
    ResolveRoutineService,
    SubstitutionsService,
  ],
  controllers: [
    ShiftsController,
    RoomsController,
    RoutineSlotsController,
    ResolveRoutineController,
    SubstitutionsController,
  ],
  exports: [
    TypeOrmModule,
    ShiftsService,
    PeriodSlotsService,
    RoomsService,
    RoutineService,
    RoutineSlotsService,
    GreedyFillService,
    ResolveRoutineService,
    SubstitutionsService,
  ],
})
export class RoutinesModule {}
