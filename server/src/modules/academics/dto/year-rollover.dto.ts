import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
} from 'class-validator';
import { YEAR_ROLLOVER_BLOCKS, type YearRolloverBlock } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { IsRealDate } from '../../../common/decorators/is-real-date.decorator';
import { IsBeforeConstraint } from './create-academic-year.dto';

/** [69.2.02] Body of `POST academic-years/:id/next`; preview takes the same as query params. */
export class YearRolloverDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @SanitizeText()
  name: string;

  @IsRealDate()
  @Validate(IsBeforeConstraint, ['end_date'])
  start_date: string;

  @IsRealDate()
  end_date: string;

  /** Omitted = every block. In a query string: `include=classes,terms` or repeated. */
  @ApiPropertyOptional({ enum: YEAR_ROLLOVER_BLOCKS, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @ArrayUnique()
  @IsIn(YEAR_ROLLOVER_BLOCKS, { each: true })
  include?: YearRolloverBlock[];
}
