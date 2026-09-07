import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { INTERNATIONAL_PHONE_REGEX } from '../../../users/dto/users.dto';

/**
 * [15.5.2] `PATCH /schools/me/profile` body. Every field is optional
 * (partial update) — a field omitted from the request is left unchanged.
 * `name`, when present, must be non-empty (a school can't unset its own
 * name). `phone`/`email` reuse the same validators as `users.phone`/
 * `users.email` for consistency across the app.
 */
export class UpdateSchoolProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_bn?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsString()
  @Matches(INTERNATIONAL_PHONE_REGEX, { message: 'Invalid phone format' })
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  registration_id?: string | null;
}
