import {
  IsUUID,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsArray,
  ArrayMinSize,
  IsOptional,
  IsDateString,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SlotRecurrence } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export class CreateRoutineDto {
  @IsUUID()
  academic_year_id: string;

  @IsString()
  @MaxLength(100)
  @SanitizeText()
  name: string;
}

/** One `POST/PATCH .../slots` payload — a single scheduled class. See
 * `RoutineSlot`'s docstring for why there's no `id` here on create, and
 * why an update never mutates a row in place (D4 effective dating). */
export class UpsertRoutineSlotDto {
  @IsUUID()
  section_id: string;

  @IsUUID()
  period_slot_id: string;

  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @IsUUID()
  subject_id: string;

  @IsOptional()
  @IsUUID()
  room_id?: string | null;

  @IsEnum(SlotRecurrence)
  recurrence: SlotRecurrence;

  @IsOptional()
  @IsInt()
  @Min(0)
  recurrence_offset?: number;

  @IsDateString()
  valid_from: string;

  @IsOptional()
  @IsDateString()
  valid_to?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  teacher_ids: string[];
}

/** `GreedyFillService.fill` request — which routine, which day(s) to fill.
 * `weekdays` omitted means every weekday `0`-`6`. */
export class GreedyFillQueryDto {
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  weekdays?: number[];
}
