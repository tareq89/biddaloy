import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { PublicExamType } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export const MIN_PASSING_YEAR = 1990;

export class CreateStudentPublicExamDto {
  @ApiProperty({ enum: Object.values(PublicExamType) })
  @IsEnum(PublicExamType)
  exam_type: PublicExamType;

  @IsString()
  @IsNotEmpty()
  @SanitizeText()
  board: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @SanitizeText()
  roll_no: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @SanitizeText()
  registration_no: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  gpa?: number;

  /** Upper bound (current year + 1) is checked in the service — a decorator would freeze it at boot. */
  @ApiProperty({ minimum: MIN_PASSING_YEAR })
  @IsInt()
  @Min(MIN_PASSING_YEAR)
  passing_year: number;
}

/** exam_type is the row's identity for the one-per-type rule; changing it = delete + re-add. */
export class UpdateStudentPublicExamDto extends PartialType(
  OmitType(CreateStudentPublicExamDto, ['exam_type'] as const),
) {}
