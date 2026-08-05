import { IsString, IsUUID, IsOptional, IsInt, Min, MaxLength, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export class CreateClassDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  @SanitizeText()
  name: string;

  @IsOptional()
  @IsInt()
  numeric_grade?: number;

  @IsNotEmpty()
  @IsUUID()
  academic_year_id: string;
}

export class UpdateClassDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @SanitizeText()
  name?: string;

  @IsOptional()
  @IsInt()
  numeric_grade?: number;
}

export class QueryClassDto {
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}

export class CreateSectionDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  @SanitizeText()
  section_name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class UpdateSectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @SanitizeText()
  section_name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}
