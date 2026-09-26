import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Request body for `POST /staff-hr-records`. 23.2.1. */
export class CreateStaffHrRecordDto {
  @IsUUID()
  user_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  index_no?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  salary_code?: string;

  @IsOptional()
  @IsDateString()
  mpo_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  salary_scale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  blood_group?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  religion?: string;
}

/** Request body for `PATCH /staff-hr-records/:id`. 23.2.1. */
export class UpdateStaffHrRecordDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  index_no?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  salary_code?: string;

  @IsOptional()
  @IsDateString()
  mpo_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  salary_scale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  blood_group?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  religion?: string;
}

/** Request body for `POST /staff-hr-records/:userId/promote`. 23.2.1. */
export class PromoteStaffDto {
  @IsUUID()
  designation_id: string;

  @IsDateString()
  effective_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
