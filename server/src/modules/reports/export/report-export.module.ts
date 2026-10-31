import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../../audit/audit.module';
import { ReportRun } from '../entities/report-run.entity';
import { ReportExportService } from './report-export.service';
import { ReportRunLogService } from './report-run-log.service';

/** [8.15.10] Streaming CSV/XLSX export plus the run log every export writes. */
@Module({
  imports: [TypeOrmModule.forFeature([ReportRun]), AuditModule],
  providers: [ReportExportService, ReportRunLogService],
  exports: [ReportExportService, ReportRunLogService],
})
export class ReportExportModule {}
