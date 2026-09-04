import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export class CreateSubjectDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  name_en: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  name_bn?: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  @SanitizeText()
  code: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateSubjectDto {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  name_en?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  name_bn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @SanitizeText()
  code?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class QuerySubjectDto {
  @IsOptional()
  @Transform(({ value }) => (value === 'false' ? false : value === 'true' ? true : value))
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export class AttachClassSubjectDto {
  @IsNotEmpty()
  @IsUUID()
  subject_id: string;

  @IsNotEmpty()
  @IsUUID()
  academic_year_id: string;

  @IsOptional()
  @IsBoolean()
  is_optional?: boolean;
}
