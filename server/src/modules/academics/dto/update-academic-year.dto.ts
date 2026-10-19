import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { IsRealDate } from '../../../common/decorators/is-real-date.decorator';

export class UpdateAcademicYearDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @SanitizeText()
  name?: string;

  @IsOptional()
  @IsRealDate()
  start_date?: string;

  @IsOptional()
  @IsRealDate()
  end_date?: string;

  @IsOptional()
  @IsBoolean()
  is_current?: boolean;
}
