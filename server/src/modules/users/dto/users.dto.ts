import {
  IsString,
  IsEmail,
  IsOptional,
  IsUUID,
  IsArray,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole, TeacherDesignation } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

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
  @SanitizeText()
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

  /** `null` clears the stored phone number; `@IsOptional()` skips
   * validation for both `null` and `undefined`. */
  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  @SanitizeText()
  full_name?: string;

  @IsOptional()
  @IsString()
  profile_picture_url?: string;
}

export class QueryUserDto {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  /** Case-insensitive match against full_name or email. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
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
  @SanitizeText()
  subject_specialization?: string;

  @IsOptional()
  @IsDateString()
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
  @SanitizeText()
  subject_specialization?: string;

  @IsOptional()
  @IsDateString()
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

  /** Scope to one member's teacher profile (e.g. "is this user already a teacher?"). */
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}
