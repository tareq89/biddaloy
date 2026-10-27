import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import {
  ArrivalNoticeChannel,
  ArrivalNoticeLock,
  ArrivalNoticeMode,
  ArrivalNoticeStatus,
} from '@biddaloy/shared';

/** `GET attendance/arrival-subscriptions`. `limit` is capped at 100 (Rule 5). */
export class QueryArrivalSubscriptionsDto {
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsEnum(ArrivalNoticeStatus)
  status?: ArrivalNoticeStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** Teacher/admin adds a subscription for a guardian; it is ACTIVE at once (D19). */
export class CreateArrivalSubscriptionDto {
  @IsUUID()
  student_id: string;

  @IsUUID()
  guardian_id: string;

  @IsEnum(ArrivalNoticeMode)
  mode: ArrivalNoticeMode;

  @IsOptional()
  @IsEnum(ArrivalNoticeChannel)
  channel?: ArrivalNoticeChannel;
}

/** Confirm (`status: ACTIVE`), decline or switch off (`status: OFF`), and/or change `mode`. */
export class UpdateArrivalSubscriptionDto {
  @IsOptional()
  @IsIn([ArrivalNoticeStatus.ACTIVE, ArrivalNoticeStatus.OFF])
  status?: ArrivalNoticeStatus.ACTIVE | ArrivalNoticeStatus.OFF;

  @IsOptional()
  @IsEnum(ArrivalNoticeMode)
  mode?: ArrivalNoticeMode;
}

export class LockArrivalSubscriptionDto {
  @IsEnum(ArrivalNoticeLock)
  lock: ArrivalNoticeLock;
}

/** Portal `PUT :studentId`. `channel` is the guardian's own pick. */
export class UpsertMyArrivalSubscriptionDto {
  @IsBoolean()
  want: boolean;

  @IsOptional()
  @IsEnum(ArrivalNoticeChannel)
  channel?: ArrivalNoticeChannel;
}

export class ArrivalSubscriptionResponseDto {
  id: string;
  student_id: string;
  guardian_id: string;
  status: ArrivalNoticeStatus;
  mode: ArrivalNoticeMode;
  channel: ArrivalNoticeChannel;
  lock: ArrivalNoticeLock;
  consumed_at: Date | null;
  updated_at: Date;
}

export class StaffArrivalSubscriptionDto extends ArrivalSubscriptionResponseDto {
  student_name: string;
  guardian_name: string;
}

export class MyArrivalChildDto {
  student_id: string;
  student_name: string;
  subscription: ArrivalSubscriptionResponseDto | null;
}

export class MyArrivalSubscriptionsDto {
  school: { enabled: boolean; smsAllowed: boolean };
  children: MyArrivalChildDto[];
}
