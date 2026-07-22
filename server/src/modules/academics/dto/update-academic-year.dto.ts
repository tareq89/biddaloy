import { IsString, IsOptional, IsBoolean, IsDateString } from 'class-validator';

export class UpdateAcademicYearDto {
  @IsOptional()
  @IsString()
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