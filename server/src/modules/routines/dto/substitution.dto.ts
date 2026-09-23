import { IsUUID, IsOptional, IsDateString, IsBoolean, IsString, MaxLength } from 'class-validator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

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
