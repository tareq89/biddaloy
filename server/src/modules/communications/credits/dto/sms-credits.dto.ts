import { IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  SmsCreditLedgerKind,
  SmsCreditLedgerReferenceType,
} from '../entities/sms-credit-ledger.entity';

/** [15.6.7/#550] `GET /communications/sms-credits`'s query — same paging
 * shape as `QueryReminderBatchesDto`, no search/sort: the ledger is always
 * newest-first, and there's nothing on a ledger row worth filtering by
 * from this tenant-facing endpoint. */
export class QuerySmsCreditsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export const SMS_READINESS = ['READY', 'NO_GATEWAY', 'NO_CREDIT'] as const;
export type SmsReadiness = (typeof SMS_READINESS)[number];

/** [78 D37] `GET /communications/sms-credits/readiness` — a status only, no
 * balance and no provider name: office staff may not read the balance. */
export class SmsReadinessResponseDto {
  @ApiProperty({ enum: SMS_READINESS })
  sms: SmsReadiness;
}

/** Shared page envelope, matching `ReminderPaginatedResponseDto`'s shape. */
export class SmsCreditLedgerPageDto {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** One ledger row. Deliberately no recipient/message data — see #550's
 * contract: the balance/history surface never carries what was sent, only
 * that a movement happened and why. */
export class SmsCreditLedgerItemDto {
  id: string;
  kind: SmsCreditLedgerKind;
  units: number;
  reference_type: SmsCreditLedgerReferenceType;
  reference_id: string | null;
  reason: string | null;
  created_at: Date;
}

export class SmsCreditLedgerListResponseDto extends SmsCreditLedgerPageDto {
  data: SmsCreditLedgerItemDto[];
}

export class SmsCreditLotItemDto {
  id: string;
  source: string;
  units_total: number;
  remaining: number;
  expires_at: Date | null;
}

export class SmsBundleOrderItemDto {
  id: string;
  name: string;
  sms_count: number;
  price_paisa: number;
  status: string;
  paid_at: Date | null;
  receipt_available: boolean;
}

/** `GET /communications/sms-credits` response. `metering` mirrors
 * `SmsCreditService.isMetered` — `OFF` still returns the (always 0/0)
 * balance and an empty ledger rather than a different shape, so the UI
 * doesn't need two response contracts. */
export class SmsCreditsBalanceResponseDto {
  metering: 'OFF' | 'PLATFORM';
  available: number;
  reserved: number;
  ledger: SmsCreditLedgerListResponseDto;
}

/** Tenant-facing page payload: the balance shape plus lots, orders, source and flags. */
export class SmsCreditsResponseDto extends SmsCreditsBalanceResponseDto {
  /** [100.2.gB-02] Unexpired lots, soonest expiry first. Empty when metering is OFF. */
  lots: SmsCreditLotItemDto[];
  /** The school's last 20 bundle orders, newest first. Empty when metering is OFF. */
  orders: SmsBundleOrderItemDto[];
  source: 'OWN' | 'SCHOOLMANAGERP';
  /** The "red notice" flag (D20). */
  almostFinished: boolean;
  stopped: boolean;
}
