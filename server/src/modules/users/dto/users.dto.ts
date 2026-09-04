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
import { UserRole, TeacherDesignation, UserStatus } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/**
 * Phone shape accepted on `users.phone`. Deliberately NOT `BD_PHONE_REGEX`
 * (the guardian/bulk-upload rule, which is Bangladesh-only): a staff member
 * or parent may legitimately hold a foreign number (`+447700900123`), and a
 * browser form happily submits a human-formatted one (`+880 1712-345678`).
 *
 * Rules, in order of the pattern:
 *   - optional leading `+`
 *   - only digits and the usual separators (space, dash, dot, parentheses)
 *   - 8–15 digits in total (E.164 caps at 15; 8 is the shortest national
 *     number in real use)
 *
 * What it still forbids is the thing that actually matters here: anything
 * email-shaped. `AuthService.validateUser` looks a caller up by
 * `email OR phone`, so a phone containing `@` would let one account shadow
 * another's login identifier. `@` is not in the character class, so it
 * cannot get in. Guardian phones keep `BD_PHONE_REGEX` — that path feeds SMS
 * dialling for a Bangladeshi school and is not changed here. [5.4a]
 */
export const INTERNATIONAL_PHONE_REGEX = /^(?=(?:\D*\d){8,15}\D*$)\+?[\d\s().-]+$/;

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
  @Matches(INTERNATIONAL_PHONE_REGEX, { message: 'Invalid phone format' })
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
  /** `null` and `''` both clear the stored email; the service maps `''` to a
   * real NULL, exactly as it does for `phone` and exactly as
   * `UpdateOwnGuardianDto.email` already does. Without the `@ValidateIf`,
   * a profile form that submits both cleared inputs (`{"email": "",
   * "phone": ""}`) got a 400 "email must be an email" while the identical
   * `phone: ''` cleared its column — two self-service endpoints disagreeing
   * about the same gesture. Clearing BOTH is still refused, but by the
   * at-least-one-identifier check in the service, with a message that says
   * so. [5.4a] */
  @IsOptional()
  @ValidateIf((o: UpdateUserDto) => o.email !== '')
  @IsEmail()
  @MaxLength(100)
  email?: string | null;

  /** `null` and `''` both clear the stored phone number (a browser form
   * submits a cleared input as `''`); the service maps `''` to a real NULL.
   * `@IsOptional()` skips validation for `null`/`undefined`, and the
   * `@ValidateIf` lets `''` through the same way UpdateGuardianDto does.
   * Otherwise the shape is pinned — see the note on CreateUserDto.phone. */
  @IsOptional()
  @ValidateIf((o: UpdateUserDto) => o.phone !== '')
  @IsString()
  @MaxLength(20)
  @Matches(INTERNATIONAL_PHONE_REGEX, { message: 'Invalid phone format' })
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

/**
 * Body of `PATCH /users/me`. Same fields as `UpdateUserDto` plus the
 * re-authentication field.
 *
 * A stolen access token (~15 minutes of life) was enough to rewrite BOTH
 * login identifiers, and there is no password-reset flow, so the real owner
 * was locked out of every school they belong to — permanently. Changing an
 * identifier therefore costs a password, the same price
 * `POST /auth/change-password` charges. `full_name` and
 * `profile_picture_url` stay friction-free: getting those wrong is a typo,
 * not a lockout.
 *
 * Only the self-service route takes this DTO. Admin `PATCH /users/:id` is a
 * different trust model — an admin editing someone else's record does not
 * know that person's password — and keeps plain `UpdateUserDto`. [5.4a]
 */
export class UpdateOwnProfileDto extends UpdateUserDto {
  /** Required only when the request actually changes `email` or `phone`;
   * the service enforces that, because only it can see the current values. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  current_password?: string;
}

export class QueryUserDto {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  /** Case-insensitive match against full_name, email, or phone. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  /** Lower bound on when this user joined *this* tenant (`UserTenant.created_at`),
   * not when their account was created globally (`User.created_at`). */
  @IsOptional()
  @IsDateString()
  joined_from?: string;

  @IsOptional()
  @IsDateString()
  joined_to?: string;

  @IsOptional()
  @IsEnum(['full_name', 'email', 'joined_at', 'status'])
  sort?: 'full_name' | 'email' | 'joined_at' | 'status';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc';

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
