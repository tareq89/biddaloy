import { IsString, IsEmail, IsOptional, IsUUID, IsArray, IsEnum } from 'class-validator';
import { UserRole, TeacherDesignation } from '@beton-boi/shared';

export class CreateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsString()
  full_name: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsUUID()
  tenantId: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  full_name?: string;

  @IsOptional()
  @IsString()
  profile_picture_url?: string;
}

export class QueryUserDto {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  page?: number = 1;

  @IsOptional()
  limit?: number = 10;
}

export class CreateTeacherDto {
  @IsUUID()
  user_id: string;

  @IsString()
  employee_id: string;

  @IsOptional()
  @IsArray()
  @IsEnum(TeacherDesignation, { each: true })
  designations?: TeacherDesignation[];

  @IsOptional()
  @IsString()
  subject_specialization?: string;

  @IsOptional()
  @IsString()
  joining_date?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  assigned_section_ids?: string[];
}

export class UpdateTeacherDto {
  @IsOptional()
  @IsString()
  employee_id?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(TeacherDesignation, { each: true })
  designations?: TeacherDesignation[];

  @IsOptional()
  @IsString()
  subject_specialization?: string;

  @IsOptional()
  @IsString()
  joining_date?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  assigned_section_ids?: string[];
}

export class QueryTeacherDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  page?: number = 1;

  @IsOptional()
  limit?: number = 10;
}