import { registerDecorator } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { LessonDeliveryReason, LessonDeliveryStatus, STUDY_PLAN_LIMITS } from '@biddaloy/shared';

/** Plain `YYYY-MM-DD` that is a real calendar day; never throws (`2026-13-01` is false). */
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Plain `YYYY-MM-DD` that is a real calendar day (date-time strings are rejected). */
export function IsCalendarDate() {
  return (target: object, key: string) =>
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName: key,
      options: { message: `${key} must be a YYYY-MM-DD date` },
      validator: {
        validate: isCalendarDate,
      },
    });
}

/** [66.2.03/#2008] `GET /lesson-deliveries?teacher=me&date=`. */
export class ListLessonDeliveriesQueryDto {
  @ApiProperty({ enum: ['me'] }) @IsIn(['me']) teacher: 'me';
  @ApiProperty() @IsCalendarDate() date: string;
}

export class PutLessonDeliveryDto {
  @ApiProperty() @IsUUID() section_id: string;
  @ApiProperty() @IsUUID() subject_id: string;
  @ApiProperty() @IsCalendarDate() date: string;
  @ApiProperty() @IsUUID() period_slot_id: string;
  @ApiProperty({ enum: Object.values(LessonDeliveryStatus) })
  @IsEnum(LessonDeliveryStatus)
  status: LessonDeliveryStatus;
  @ApiPropertyOptional({ enum: Object.values(LessonDeliveryReason) })
  @IsOptional()
  @IsEnum(LessonDeliveryReason)
  reason?: LessonDeliveryReason;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(STUDY_PLAN_LIMITS.deliveryNoteMax)
  note?: string;
}

export class ExtraLessonDeliveryDto {
  @ApiProperty() @IsUUID() section_id: string;
  @ApiProperty() @IsUUID() subject_id: string;
  @ApiProperty() @IsCalendarDate() date: string;
  @ApiProperty() @IsUUID() period_slot_id: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(STUDY_PLAN_LIMITS.deliveryNoteMax)
  note?: string;
}

export class LessonDeliveryDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: Object.values(LessonDeliveryStatus) }) status: LessonDeliveryStatus;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty() is_extra: boolean;
  @ApiProperty() auto: boolean;
  @ApiProperty({ description: 'ISO instant of the last change (D44).' }) recorded_at: string;
}

/** A saved row plus the key that places it. */
export class SavedLessonDeliveryDto extends LessonDeliveryDto {
  @ApiProperty() section_id: string;
  @ApiProperty() subject_id: string;
  @ApiProperty() date: string;
  @ApiProperty() period_slot_id: string;
}

export class TodayAllTaughtResponseDto {
  @ApiProperty() created: number;
  @ApiProperty() skipped: number;
  @ApiProperty({ type: [SavedLessonDeliveryDto] }) deliveries: SavedLessonDeliveryDto[];
}

export class LessonDeliveryPeriodDto {
  @ApiProperty() section: { id: string; name: string };
  @ApiProperty() subject: { id: string; name_en: string | null; name_bn: string | null };
  @ApiProperty() period_slot_id: string;
  @ApiProperty() sequence: number;
  @ApiProperty() starts_at: string;
  @ApiProperty() ends_at: string;
  @ApiProperty() routine_slot_id: string;
  @ApiProperty() substituting: boolean;
  @ApiProperty() cancelled: boolean;
  @ApiProperty({ nullable: true, type: String }) plan_id: string | null;
  @ApiProperty({ nullable: true })
  lesson: { id: string; number: number; title: string; part: number; of: number } | null;
  @ApiProperty({ nullable: true, type: LessonDeliveryDto }) delivery: LessonDeliveryDto | null;
  @ApiProperty() can_mark: boolean;
}

export class LessonDeliveriesDayDto {
  @ApiProperty() date: string;
  @ApiProperty({ type: [LessonDeliveryPeriodDto] }) periods: LessonDeliveryPeriodDto[];
  @ApiProperty() due: {
    unreported_periods: number;
    oldest_date: string | null;
    school_days_until_escalation: number;
  };
}
