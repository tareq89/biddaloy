import { IsString, IsOptional, IsBoolean, IsDateString, MaxLength } from 'class-validator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export class UpdateAcademicYearDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @SanitizeText()
  name?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsBoolean()
  is_current?: boolean;
}
