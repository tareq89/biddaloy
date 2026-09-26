import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { StaffEmploymentStatus } from '../enums/index';

/** Job-level HR fields for one staff member. 23.1. */
export class StaffHrRecordDto {
  @IsUUID()
  staff_user_id: string;

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

/** One entry in a staff member's designation history. 23.1. */
export class StaffDesignationHistoryDto {
  @IsUUID()
  user_id: string;

  @IsUUID()
  designation_id: string;

  @IsDateString()
  effective_date: string;

  @ValidateIf((o: StaffDesignationHistoryDto) => o.end_date !== null && o.end_date !== undefined)
  @IsDateString()
  end_date?: string | null;

  @IsEnum(StaffEmploymentStatus)
  status: StaffEmploymentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Family member row (one of the 7 dynamic-row sections). 23.1. */
export class StaffFamilyMemberDto {
  @IsUUID()
  id: string;

  @IsUUID()
  staff_user_id: string;

  @IsString()
  @MaxLength(100)
  relation: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  occupation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contact?: string;
}

/** Address row (present/permanent), one of the 7 dynamic-row sections. 23.1. */
export class StaffAddressDto {
  @IsUUID()
  id: string;

  @IsUUID()
  staff_user_id: string;

  @IsIn(['PRESENT', 'PERMANENT'])
  type: 'PRESENT' | 'PERMANENT';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  village_street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  post_office?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  upazila?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;
}

/** Prior work experience row, one of the 7 dynamic-row sections. 23.1. */
export class StaffExperienceDto {
  @IsUUID()
  id: string;

  @IsUUID()
  staff_user_id: string;

  @IsString()
  @MaxLength(200)
  institution: string;

  @IsString()
  @MaxLength(200)
  designation: string;

  @IsDateString()
  from_date: string;

  @IsOptional()
  @IsDateString()
  to_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

/** Education row, one of the 7 dynamic-row sections. 23.1. */
export class StaffEducationDto {
  @IsUUID()
  id: string;

  @IsUUID()
  staff_user_id: string;

  @IsString()
  @MaxLength(200)
  degree: string;

  @IsString()
  @MaxLength(200)
  institution: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  board_university?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  result?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  passing_year?: string;
}

/** Training row, one of the 7 dynamic-row sections. 23.1. */
export class StaffTrainingDto {
  @IsUUID()
  id: string;

  @IsUUID()
  staff_user_id: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsString()
  @MaxLength(200)
  institution: string;

  @IsDateString()
  from_date: string;

  @IsOptional()
  @IsDateString()
  to_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  certificate_no?: string;
}

/** Achievement row, one of the 7 dynamic-row sections. 23.1. */
export class StaffAchievementDto {
  @IsUUID()
  id: string;

  @IsUUID()
  staff_user_id: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  issued_by?: string;
}

/** Language proficiency row, one of the 7 dynamic-row sections. 23.1. */
export class StaffLanguageDto {
  @IsUUID()
  id: string;

  @IsUUID()
  staff_user_id: string;

  @IsString()
  @MaxLength(100)
  language_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  proficiency?: string;
}
