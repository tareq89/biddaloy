import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeatPlan } from './entities/seat-plan.entity';
import { SeatPlanSchedule } from './entities/seat-plan-schedule.entity';
import { SeatAllocation } from './entities/seat-allocation.entity';
import { ExamSchedule } from '../exams/entities/exam-schedule.entity';
import { Room } from '../routines/entities/room.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { RoutinesModule } from '../routines/routines.module';
import { SeatPlansService } from './seat-plans.service';
import { SeatPlansController } from './seat-plans.controller';
import { SeatPlansDashboardController } from './seat-plans-dashboard.controller';
import { SeatPlansDashboardService } from './seat-plans-dashboard.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { SchoolsModule } from '../schools/schools.module';

/**
 * [25.4] Generate/list/edit/reshuffle/invigilator/publish surface for seat
 * plans, on top of the entities [25.1.1] registered.
 */
@Module({
  imports: [
    // TEN-07: `TeacherBusyService` for the invigilator clash check.
    RoutinesModule,
    DashboardModule,
    SchoolsModule,
    TypeOrmModule.forFeature([
      SeatPlan,
      SeatPlanSchedule,
      SeatAllocation,
      ExamSchedule,
      Room,
      ClassSection,
      Enrollment,
      UserTenant,
    ]),
  ],
  controllers: [SeatPlansController, SeatPlansDashboardController],
  providers: [SeatPlansService, SeatPlansDashboardService],
})
export class SeatPlansModule {}
