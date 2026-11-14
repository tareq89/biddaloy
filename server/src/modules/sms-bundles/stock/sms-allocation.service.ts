import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ProviderBalanceReader } from './provider-balance.reader';
import { SmsStockService } from './sms-stock.service';

/** [100.2.A1] Would new sales promise more SMS than the provider holds? Read-only. */
@Injectable()
export class SmsAllocationService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly reader: ProviderBalanceReader,
    private readonly stock: SmsStockService,
  ) {}

  /**
   * Remaining of unexpired lots plus reserved units, for PLATFORM-metered schools only
   * (tenant settings `communications.sms.metering`; absent = OFF). Expired remainder never counts.
   */
  async promisedUnused(m?: EntityManager): Promise<number> {
    const [row]: Array<{ total: string }> = await (m ?? this.ds).query(
      `SELECT COALESCE(SUM(
                CASE WHEN l.expires_at IS NULL OR l.expires_at > now() THEN l.remaining ELSE 0 END
                + l.reserved_units), 0)::text AS total
         FROM sms_credit_lots l
         JOIN schools s ON s.id = l.tenant_id
        WHERE COALESCE(
                NULLIF(s.settings #>> '{communications,sms,source}', ''),
                CASE WHEN s.settings #>> '{communications,sms,metering}' = 'PLATFORM'
                     THEN 'SCHOOLMANAGERP' END
              ) = 'SCHOOLMANAGERP'`,
    );
    return Number(row?.total ?? 0);
  }

  /** UNKNOWN balance is NOT oversold: a failed read never blocks a purchase (D29). */
  async isOversold(m?: EntityManager): Promise<boolean> {
    const balance = await this.reader.read();
    if (balance.sms === null) return false;
    return (await this.promisedUnused(m)) > balance.sms;
  }

  weightedAverageCostPaisaPerSms(): Promise<number | null> {
    return this.stock.weightedAverageCostPaisaPerSms();
  }
}
