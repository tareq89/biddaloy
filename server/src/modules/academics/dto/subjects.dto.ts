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

  /** [35.1.2] Must be in `organisation.groups`; ''/null = not group-specific. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  group_name?: string | null;

  /** [35.1.8] 'Exactly one of' set within the class+year; ''/null = none. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  choice_group?: string | null;
}

export class UpdateClassSubjectDto {
  @IsUUID()
  academic_year_id: string;

  @IsOptional()
  @IsBoolean()
  is_optional?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  group_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  choice_group?: string | null;
}
