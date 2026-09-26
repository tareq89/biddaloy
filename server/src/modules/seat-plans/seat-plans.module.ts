import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeatPlan } from './entities/seat-plan.entity';
import { SeatPlanSchedule } from './entities/seat-plan-schedule.entity';
import { SeatAllocation } from './entities/seat-allocation.entity';

/**
 * [25.1.1] Entities only for now — no controllers/services yet. Later
 * Epic 25.0 tickets (#25.4 onward) add the CRUD/generation surface.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SeatPlan, SeatPlanSchedule, SeatAllocation])],
})
export class SeatPlansModule {}
