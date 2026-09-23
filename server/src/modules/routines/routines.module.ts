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
import { SchoolsModule } from '../schools/schools.module';

/**
 * [21.2.1] registers the eight class-routine/timetable tables with
 * TypeORM. [21.3.1] adds the setup layer — shifts, period slots, rooms —
 * on top; later Epic 21.0 tickets add routine-building/publishing.
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
    ]),
    // Only `SchoolSettingsReader` is used ([21.3.1]'s changeover-suggestion
    // reading `TenantSettings.routine`) — same reasoning as
    // `ClassModule`'s import of `SchoolsModule`.
    SchoolsModule,
  ],
  providers: [ShiftsService, PeriodSlotsService, RoomsService],
  controllers: [ShiftsController, RoomsController],
  exports: [TypeOrmModule, ShiftsService, PeriodSlotsService, RoomsService],
})
export class RoutinesModule {}
