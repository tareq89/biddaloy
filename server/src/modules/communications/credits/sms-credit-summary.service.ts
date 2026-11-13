import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { SmsLotStatus } from '@biddaloy/shared';
import { SchoolsService } from '../../schools/schools.service';
import { readSmsSource, SmsSource } from '../sms-source/sms-source.util';
import { SmsBundleOrder } from '../../sms-bundles/entities/sms-bundle-order.entity';
import { SmsCreditLot } from './entities/sms-credit-lot.entity';
import { isAlmostFinished } from './sms-low.util';

export interface SmsCreditLotView {
  id: string;
  source: string;
  units_total: number;
  remaining: number;
  expires_at: Date | null;
}

export interface SmsBundleOrderView {
  id: string;
  name: string;
  sms_count: number;
  price_paisa: number;
  status: string;
  paid_at: Date | null;
  receipt_available: boolean;
}

export interface SmsCreditSchoolSummary {
  lots: SmsCreditLotView[];
  orders: SmsBundleOrderView[];
  source: SmsSource;
  almostFinished: boolean;
  stopped: boolean;
}

const ORDER_LIMIT = 20;

/** [100.2.gB-02] Read-only view for the SMS credits page. Never writes `sms_credit_*`. */
@Injectable()
export class SmsCreditSummaryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly schools: SchoolsService,
  ) {}

  async forSchool(tenantId: string): Promise<SmsCreditSchoolSummary> {
    const settings = await this.schools.getResolvedSettings(tenantId);
    const source = readSmsSource(settings as unknown as Record<string, unknown>);
    // Metering OFF keeps today's zeroed contract: nothing about lots or orders.
    if (settings.communications?.sms?.metering !== 'PLATFORM') {
      return { lots: [], orders: [], source, almostFinished: false, stopped: false };
    }

    const now = new Date();
    const active = { tenant_id: tenantId, status: SmsLotStatus.ACTIVE };
    const [lots, orders] = await Promise.all([
      // Expired and used-up lots are not shown.
      this.dataSource.getRepository(SmsCreditLot).find({
        where: [
          { ...active, expires_at: IsNull() },
          { ...active, expires_at: MoreThan(now) },
        ],
      }),
      this.dataSource.getRepository(SmsBundleOrder).find({
        where: { school_id: tenantId },
        order: { created_at: 'DESC' },
        take: ORDER_LIMIT,
      }),
    ]);

    // Soonest expiry first, never-expiring last.
    lots.sort(
      (a, b) =>
        (a.expires_at?.getTime() ?? Infinity) - (b.expires_at?.getTime() ?? Infinity) ||
        a.created_at.getTime() - b.created_at.getTime(),
    );
    const remaining = lots.reduce((sum, l) => sum + l.remaining, 0);

    return {
      lots: lots.map((l) => ({
        id: l.id,
        source: l.source,
        units_total: l.units_total,
        remaining: l.remaining,
        expires_at: l.expires_at,
      })),
      orders: orders.map((o) => ({
        id: o.id,
        name: o.name_snapshot,
        sms_count: o.sms_count,
        price_paisa: Number(o.price_paisa),
        status: o.status,
        paid_at: o.paid_at,
        receipt_available: o.receipt_number !== null,
      })),
      source,
      ...isAlmostFinished({ remaining, activeLots: lots }),
    };
  }
}
