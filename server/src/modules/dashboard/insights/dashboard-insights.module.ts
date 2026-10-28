import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AttendanceModule } from '../../attendance/attendance.module';
import { SchoolsModule } from '../../schools/schools.module';
import { DashboardModule } from '../dashboard.module';
import { AtRiskProcessor } from './at-risk.processor';
import { AtRiskService } from './at-risk.service';
import { AtRiskStudentsDashboardController } from './at-risk-students-dashboard.controller';
import { AT_RISK_QUEUE } from './at-risk.constants';

/**
 * Widgets that read across owner modules (the wave-1 `DashboardModule` core is imported BY
 * owner modules, so it cannot import them back).
 */
@Module({
  imports: [
    DashboardModule,
    AttendanceModule,
    SchoolsModule,
    BullModule.registerQueue({ name: AT_RISK_QUEUE }),
  ],
  providers: [AtRiskService, AtRiskProcessor],
  controllers: [AtRiskStudentsDashboardController],
})
export class DashboardInsightsModule {}
