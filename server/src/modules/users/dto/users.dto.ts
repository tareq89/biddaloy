import {
  IsString,
  IsEmail,
  IsOptional,
  MaxLength,
  Matches,
  ValidateIf,
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
import { BD_PHONE_REGEX } from '../../students/dto/students.dto';

export class CreateUserDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  email?: string;

  // `users.phone` is matched by the OR'd login lookup in
  // AuthService.validateUser, so a phone that looks like an email would let
  // one account shadow another's login identifier. Pinning the shape closes
  // that door; the column is varchar(20). [5.4a]
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(BD_PHONE_REGEX, { message: 'Invalid phone format' })
  phone?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsString()
  @MaxLength(100)
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
  @MaxLength(100)
  email?: string;

  /** `null` and `''` both clear the stored phone number (a browser form
   * submits a cleared input as `''`); the service maps `''` to a real NULL.
   * `@IsOptional()` skips validation for `null`/`undefined`, and the
   * `@ValidateIf` lets `''` through the same way UpdateGuardianDto does.
   * Otherwise the shape is pinned — see the note on CreateUserDto.phone. */
  @IsOptional()
  @ValidateIf((o: UpdateUserDto) => o.phone !== '')
  @IsString()
  @MaxLength(20)
  @Matches(BD_PHONE_REGEX, { message: 'Invalid phone format' })
  phone?: string | null;

  // Length-pinned to the column widths (`full_name` varchar(100),
  // `profile_picture_url` varchar(255)). Without these an over-long value
  // reaches Postgres and comes back as a 22001 `string_data_right_truncation`
  // — which `UserService.update` does not map (it only handles 23505), so
  // the caller sees a 500 instead of a 400. [5.4a]
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  full_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
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

  /** `null` clears the stored value; `@IsOptional()` skips validation
   * for both `null` and `undefined`. */
  @IsOptional()
  @IsString()
  @SanitizeText()
  subject_specialization?: string | null;

  /** `null` clears the stored value — the service maps it to a SQL NULL
   * instead of `new Date(null)`'s Unix epoch. */
  @IsOptional()
  @IsDateString()
  joining_date?: string | null;

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
