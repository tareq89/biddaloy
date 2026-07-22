import { IsString, IsEmail, IsOptional, IsUUID, IsArray, IsEnum, IsInt, Min, IsDateString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { CommunicationMedium, EnrollmentStatus } from '@beton-boi/shared';

export class CreateStudentDto {
  @IsString()
  @IsNotEmpty()
  full_name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsUUID()
  class_section_id: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  roll_number?: number;

  @IsOptional()
  @IsDateString()
  date_of_birth?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  home_address?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  guardian_ids?: string[];
}

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  full_name?: string;

  @IsOptional()
  @IsUUID()
  class_section_id?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  roll_number?: number;

  @IsOptional()
  @IsDateString()
  date_of_birth?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  home_address?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  @IsOptional()
  @IsEnum(EnrollmentStatus)
  enrollment_status?: EnrollmentStatus;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  guardian_ids?: string[];
}

export class QueryStudentDto {
  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;

  @IsOptional()
  @IsEnum(EnrollmentStatus)
  enrollment_status?: EnrollmentStatus;

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

export class CreateGuardianDto {
  @IsString()
  @IsNotEmpty()
  full_name: string;

  @IsOptional()
  @IsString()
  relationship?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  alternate_phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  occupation?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  student_ids?: string[];
}

export class UpdateGuardianDto {
  @IsOptional()
  @IsString()
  full_name?: string;

  @IsOptional()
  @IsString()
  relationship?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  alternate_phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  occupation?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  student_ids?: string[];
}

export class QueryGuardianDto {
  @IsOptional()
  @IsString()
  search?: string;

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