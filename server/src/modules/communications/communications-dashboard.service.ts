import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { CommunicationMedium, CommunicationStatus, DashboardWidgetKey } from '@biddaloy/shared';
import { localToday, startOfLocalDay } from '../../common/time';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { SmsCreditService } from './credits/sms-credit.service';
import { CommunicationLog } from './entities/communication-log.entity';
import type {
  FailedMessagesWidgetDto,
  SmsBalanceWidgetDto,
} from './dto/communications-dashboard.dto';

export const FAILED_MESSAGES_WINDOW_DAYS = 7;

/** Date-string arithmetic: no server-local `Date` involved. */
function minusDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** "SMS balance" and "Failed messages" dashboard widgets (ADMIN). */
@Injectable()
export class CommunicationsDashboardService {
  constructor(
    @InjectRepository(CommunicationLog) private readonly logRepo: Repository<CommunicationLog>,
    private readonly credits: SmsCreditService,
    private readonly cache: DashboardCacheService,
  ) {}

  getSmsBalance(tenantId: string): Promise<SmsBalanceWidgetDto> {
    return this.cache.getOrLoad(tenantId, DashboardWidgetKey.SMS_BALANCE, 'school', async () => {
      const { metering, available, reserved } = await this.credits.getCreditsSummary(
        tenantId,
        1,
        1,
      );
      return { metering, available, reserved };
    });
  }

  getFailedMessages(tenantId: string): Promise<FailedMessagesWidgetDto> {
    return this.cache.getOrLoad(
      tenantId,
      DashboardWidgetKey.FAILED_MESSAGES,
      'school',
      async () => {
        const to = localToday();
        const from = minusDays(to, FAILED_MESSAGES_WINDOW_DAYS - 1);
        const failed = await this.logRepo.count({
          where: {
            tenant_id: tenantId,
            medium: CommunicationMedium.SMS,
            status: CommunicationStatus.FAILED,
            created_at: MoreThanOrEqual(startOfLocalDay(from)),
          },
        });
        return { failed, window: { from, to } };
      },
    );
  }
}
