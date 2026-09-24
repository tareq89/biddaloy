import {
  IsUUID,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsString,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** A slot is either cancelled or covered by a substitute, never both —
 * otherwise the resolver would emit `cancelled: true` alongside a
 * `substitute_teacher_id`. */
@ValidatorConstraint({ name: 'notCancelledWithSubstitute', async: false })
class NotCancelledWithSubstituteConstraint implements ValidatorConstraintInterface {
  validate(isCancelled: boolean | undefined, args: ValidationArguments): boolean {
    if (!isCancelled) return true;
    return !(args.object as { substitute_teacher_id?: string | null }).substitute_teacher_id;
  }

  defaultMessage(): string {
    return 'is_cancelled cannot be true when substitute_teacher_id is set';
  }
}

/** Record a cover or a cancellation for one slot on one date. Never
 * touches `routine_slots` (D12) — this is the whole payload for both
 * "cancelled, no substitute" and "covered by someone else". */
export class UpsertSubstitutionDto {
  @IsUUID()
  routine_slot_id: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsUUID()
  substitute_teacher_id?: string | null;

  @IsOptional()
  @IsBoolean()
  @Validate(NotCancelledWithSubstituteConstraint)
  is_cancelled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  @SanitizeText()
  reason?: string | null;
}

/** `GET /routines/substitutions` query — the substitution log, filtered. */
export class QuerySubstitutionsDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  substitute_teacher_id?: string;

  @IsOptional()
  @IsUUID()
  covered_for_teacher_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;
}
