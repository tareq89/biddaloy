import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditDashboardController } from './audit-dashboard.controller';
import { AuditInterceptor } from './audit.interceptor';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), DashboardModule],
  controllers: [AuditController, AuditDashboardController],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
