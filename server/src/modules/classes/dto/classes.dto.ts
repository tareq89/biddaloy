import { IsString, IsUUID, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateClassDto {
  @IsString()
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
  section_name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class UpdateSectionDto {
  @IsOptional()
  @IsString()
  section_name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}