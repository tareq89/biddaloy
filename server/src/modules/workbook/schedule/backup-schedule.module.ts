import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SchoolsModule } from '../../schools/schools.module';
import { ExportModule } from '../export/export.module';
import { BACKUP_SCHEDULE_QUEUE } from './backup-schedule.constants';
import { BackupScheduleService } from './backup-schedule.service';
import { BackupScheduleProcessor } from './backup-schedule.processor';

/**
 * `backup.schedule` (14.12.1/#615). A settings change takes effect within
 * at most one hour — the hourly reconciler (`BackupScheduleProcessor`) is
 * the only resync path; there is deliberately no immediate resync on
 * settings save (would require a `SchoolsModule` <-> `ExportModule`
 * forwardRef cycle — see `BackupScheduleService`'s doc comment). #617
 * owns adding an immediate resync from its controller layer if ever
 * needed.
 */
@Module({
  imports: [
    SchoolsModule,
    ExportModule,
    BullModule.registerQueue({
      name: BACKUP_SCHEDULE_QUEUE,
      // attempts: 1, not 2 — a failed tick is retried by the *next* tick,
      // not immediately. ExportService.run() already gives the export
      // itself attempts: 2.
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: 100 },
    }),
  ],
  providers: [BackupScheduleService, BackupScheduleProcessor],
  exports: [BackupScheduleService],
})
export class BackupScheduleModule {}
