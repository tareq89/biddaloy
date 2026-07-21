import { IsString, IsUUID, IsOptional, IsInt, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateClassDto {
  @IsString()
  @MaxLength(50)
  name: string;

  @IsOptional()
  @IsInt()
  numeric_grade?: number;

  @IsUUID()
  academic_year_id: string;
}

export class UpdateClassDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
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
  @IsString()
  @MaxLength(20)
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
  section_name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}