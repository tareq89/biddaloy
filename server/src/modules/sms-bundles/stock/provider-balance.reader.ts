import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CommunicationMedium } from '@biddaloy/shared';
import { MessagingConfigResolver } from '../../communications/config/messaging-config.resolver';
import { SmsProviderBalanceReading } from '../entities/sms-provider-balance-reading.entity';
import { SmsStockService } from './sms-stock.service';

export interface ProviderBalance {
  sms: number | null;
  source: 'PROVIDER' | 'ENTERED' | 'UNKNOWN';
  asOf: Date | null;
  stale: boolean;
}

export const LIVE_TIMEOUT_MS = 2000;
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** [D29] Never throws: a failed read is UNKNOWN, and UNKNOWN never blocks a sale. */
@Injectable()
export class ProviderBalanceReader {
  private readonly logger = new Logger(ProviderBalanceReader.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly resolver: MessagingConfigResolver,
    private readonly stock: SmsStockService,
  ) {}

  async read(now: Date = new Date()): Promise<ProviderBalance> {
    const live = await this.live();
    if (live !== null) return { sms: live, source: 'PROVIDER', asOf: now, stale: false };
    try {
      const row = await this.ds.getRepository(SmsProviderBalanceReading).findOne({
        where: {},
        order: { created_at: 'DESC', id: 'DESC' },
      });
      if (row) {
        return {
          sms: row.sms_balance,
          source: 'ENTERED',
          asOf: row.created_at,
          stale: now.getTime() - row.created_at.getTime() > STALE_AFTER_MS,
        };
      }
    } catch {
      this.logger.warn('Entered provider balance could not be read.');
    }
    return { sms: null, source: 'UNKNOWN', asOf: null, stale: false };
  }

  private async live(): Promise<number | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const attempt = (async () => {
        const { provider, config } = await this.resolver.resolve(CommunicationMedium.SMS, null, {
          allowPlatformKeys: true,
        });
        if (!provider.descriptor.capabilities.includes('balance') || !provider.getBalance) {
          return null;
        }
        const res = await provider.getBalance(config);
        if (typeof res.estimateSms === 'number' && Number.isFinite(res.estimateSms)) {
          return Math.max(0, Math.floor(res.estimateSms));
        }
        // Money balance: divide by the weighted cost per SMS (paisa) when we know it.
        const cost = await this.stock.weightedAverageCostPaisaPerSms();
        if (!cost || !Number.isFinite(res.amount) || res.amount < 0) return null;
        return Math.floor((res.amount * 100) / cost);
      })();
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LIVE_TIMEOUT_MS);
      });
      return await Promise.race([attempt, timeout]);
    } catch {
      this.logger.warn('Live provider balance unavailable; falling back.');
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
