import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SchoolsModule } from '../../schools/schools.module';
import { CalendarModule } from '../../calendar/calendar.module';
import { PushModule } from '../../push/push.module';
import { AttentionModule } from '../../attention/attention.module';
import { DASHBOARD_DIGEST_QUEUE } from './digest.constants';
import { DigestScheduleService } from './digest-schedule.service';
import { DigestScheduleProcessor } from './digest-schedule.processor';

/** Morning digest push (8.10.7.5.12). A settings change applies within an hour (reconciler). */
@Module({
  imports: [
    SchoolsModule,
    CalendarModule,
    PushModule,
    AttentionModule,
    // attempts: 1 - a failed tick is not retried; the next day's tick runs again.
    BullModule.registerQueue({
      name: DASHBOARD_DIGEST_QUEUE,
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: 100 },
    }),
  ],
  providers: [DigestScheduleService, DigestScheduleProcessor],
})
export class DigestModule {}
