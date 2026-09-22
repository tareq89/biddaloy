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

/**
 * [21.2.1] entity-only — registers the eight class-routine/timetable
 * tables with TypeORM. Later tickets in Epic 21.0 add the service and
 * controller layers that actually read/write through this module; until
 * then it exists so `server/test/all-entities.ts` and migrations have a
 * home for the schema.
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
  ],
  exports: [TypeOrmModule],
})
export class RoutinesModule {}
