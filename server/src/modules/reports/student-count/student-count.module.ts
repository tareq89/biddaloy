import { Module } from '@nestjs/common';
import { StudentCountController } from './student-count.controller';
import { StudentCountService } from './student-count.service';

/**
 * [8.15.53] Its own module (imported by `AppModule`) so `reports.module.ts` stays untouched.
 * `ReportExportService` comes from the global `ReportExportModule`. Removed at the epic close (D23).
 */
@Module({
  controllers: [StudentCountController],
  providers: [StudentCountService],
})
export class StudentCountModule {}
