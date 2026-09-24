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
  Matches,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
  ValidateIf,
  ValidationArguments,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { SlotRecurrence } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** `IsDateString()` also accepts full ISO timestamps; every caller here
 * treats `valid_from`/`valid_to` as date-only strings (recurrence/range
 * comparisons split or compare them lexically), so restrict to that. */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valid `recurrence_offset` ranges depend on `recurrence`: WEEKLY only
 * ever means "every week" (0), BIWEEKLY picks which of the two
 * alternating weeks (0 or 1), MONTHLY picks the nth weekday-in-month
 * (1-5) or "last" (-1). See `occursOn`/`recurrenceIntersects` for how
 * each is interpreted — an out-of-range offset here would let two slots
 * that actually occur on the same date pass as non-clashing. */
@ValidatorConstraint({ name: 'recurrenceOffsetForType', async: false })
class RecurrenceOffsetForTypeConstraint implements ValidatorConstraintInterface {
  validate(value: number | undefined, args: ValidationArguments): boolean {
    const recurrence = (args.object as { recurrence?: SlotRecurrence }).recurrence;
    // MONTHLY has no default offset that means anything — `persist`
    // defaults an omitted offset to 0, but `occursOn` never matches
    // offset 0 for MONTHLY, so a MONTHLY slot created without one would
    // silently never occur. Every other recurrence tolerates omission.
    if (value === undefined) return recurrence !== SlotRecurrence.MONTHLY;
    switch (recurrence) {
      case SlotRecurrence.WEEKLY:
        return value === 0;
      case SlotRecurrence.BIWEEKLY:
        return value === 0 || value === 1;
      case SlotRecurrence.MONTHLY:
        return value === -1 || (value >= 1 && value <= 5);
      default:
        return true;
    }
  }

  defaultMessage(): string {
    return 'recurrence_offset is not valid for this recurrence type';
  }
}

/** The migration's `CHK_routine_slots_valid_range` rejects an inverted
 * range at the DB, which `AllExceptionsFilter` then surfaces as a raw
 * 500 — this catches it here as a clean 400 instead. `null` valid_to
 * (open-ended) always passes. */
@ValidatorConstraint({ name: 'validToAfterValidFrom', async: false })
class ValidToAfterValidFromConstraint implements ValidatorConstraintInterface {
  validate(value: string | null | undefined, args: ValidationArguments): boolean {
    if (value == null) return true;
    const from = (args.object as { valid_from?: string }).valid_from;
    return typeof from !== 'string' || value >= from;
  }

  defaultMessage(): string {
    return 'valid_to must be on or after valid_from';
  }
}

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

  // `@IsOptional()` would skip every validator below (including
  // `@Validate`) when the field is omitted, which is exactly the case
  // `RecurrenceOffsetForTypeConstraint` exists to catch for MONTHLY —
  // `@ValidateIf` runs the chain unless the value truly doesn't need
  // checking (non-MONTHLY and omitted).
  @ValidateIf(
    (o: UpsertRoutineSlotDto) =>
      o.recurrence === SlotRecurrence.MONTHLY || o.recurrence_offset != null,
  )
  @IsInt()
  @Validate(RecurrenceOffsetForTypeConstraint)
  recurrence_offset?: number;

  @IsDateString()
  @Matches(DATE_ONLY_RE, { message: 'valid_from must be YYYY-MM-DD' })
  valid_from: string;

  @IsOptional()
  @IsDateString()
  @Matches(DATE_ONLY_RE, { message: 'valid_to must be YYYY-MM-DD' })
  @Validate(ValidToAfterValidFromConstraint)
  valid_to?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  teacher_ids: string[];
}

/** `GreedyFillService.fill` request — which routine, which day(s) to fill.
 * `weekdays` omitted means every weekday `0`-`6`. */
export class GreedyFillQueryDto {
  // A single `?weekdays=1` arrives as the bare string `'1'`, not `['1']`
  // — `@Query()` only wraps repeated keys into an array. Normalize before
  // the array/int validators below ever see it.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : (Array.isArray(value) ? value : [value]).map(Number),
  )
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];
}
