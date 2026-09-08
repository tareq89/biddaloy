import { IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
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

/** `GET /communications/sms-credits` response. `metering` mirrors
 * `SmsCreditService.isMetered` — `OFF` still returns the (always 0/0)
 * balance and an empty ledger rather than a different shape, so the UI
 * doesn't need two response contracts. */
export class SmsCreditsResponseDto {
  metering: 'OFF' | 'PLATFORM';
  available: number;
  reserved: number;
  ledger: SmsCreditLedgerListResponseDto;
}
