import { IsString, IsUUID, IsOptional, IsNotEmpty, MaxLength, Matches } from 'class-validator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** `HH:MM` or `HH:MM:SS`, 24h. Matches the `time` column's accepted shape. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export class CreateExamScheduleDto {
  @IsNotEmpty()
  @IsUUID()
  subject_id: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be an ISO date (YYYY-MM-DD)' })
  date: string;

  @IsNotEmpty()
  @IsString()
  @Matches(TIME_RE, { message: 'starts_at must be a 24h time (HH:MM or HH:MM:SS)' })
  starts_at: string;

  @IsNotEmpty()
  @IsString()
  @Matches(TIME_RE, { message: 'ends_at must be a 24h time (HH:MM or HH:MM:SS)' })
  ends_at: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  venue?: string | null;
}

export class UpdateExamScheduleDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be an ISO date (YYYY-MM-DD)' })
  date?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_RE, { message: 'starts_at must be a 24h time (HH:MM or HH:MM:SS)' })
  starts_at?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_RE, { message: 'ends_at must be a 24h time (HH:MM or HH:MM:SS)' })
  ends_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  venue?: string | null;
}
